// TODO split code into multiple files
import type {
  MergeRequestAttributes,
  MergeRequestEvent,
} from "./gitlabHooks.d.ts";
import type { PullRequest, PullRequestDraft } from "./githubTypes.d.ts";
import type { WorkflowJobCompletedEvent } from "https://raw.githubusercontent.com/octokit/webhooks/main/payload-types/schema.d.ts";

function extractJiraTicketFromMRTitle(title: string): string | null {
  const regex = /.*:.*\(([a-zA-Z]+-[0-9]+)\)/g;
  return Array.from(title.matchAll(regex), (m) => m[1])?.[0] ?? null;
}

function getEnvMapping(envVariableName: string): Map<string, string> {
  const keyValueMap = new Map<string, string>();
  const keyValueMappings = Deno.env.get(envVariableName);
  if (keyValueMappings) {
    keyValueMappings.split(";").forEach((keyValue) => {
      const keyValueArray = keyValue.split("=");
      if (keyValueArray.length === 2) {
        keyValueMap.set(keyValueArray[0], keyValueArray[1]);
      }
    });
  }
  return keyValueMap;
}

function getGitHubRepoName(mergeRequest: MergeRequestEvent): string {
  const gitLabRepoName = mergeRequest.repository.name;
  const repoNameMapping = getEnvMapping("GITLAB_TO_GITHUB_MAPPING");
  if (repoNameMapping.has(gitLabRepoName)) {
    return repoNameMapping.get(gitLabRepoName)!;
  }
  return gitLabRepoName;
}

async function checkIfGithubPullRequestExists(
  token: string,
  owner: string,
  mergeRequest: MergeRequestEvent,
): Promise<boolean | undefined> {
  // change match by cases, where the mirrored name differs

  const title = mergeRequest.object_attributes.title;

  try {
    const pullRequests = await getGithubPullRequests(
      token,
      owner,
      mergeRequest,
    );

    console.log("Pull requests: ", pullRequests.map((pr) => pr.title).join(";"), title);

    // TODO use last commit id instead?
    // The commits can be obtained by pullRequests[0]?._links?.commits?.href for each pull request
    const matchingPullRequest = pullRequests.find(
      (pullRequest: PullRequest) => {
        return pullRequest.title === title
      },
    );
    console.log("matchingPullRequest: ", matchingPullRequest);
    return typeof matchingPullRequest !== "undefined";
  } catch (e) {
    console.error("Error by getting all github pull requests:", e);
    return undefined;
  }
}

async function getGithubPullRequests(
  token: string,
  owner: string,
  mergeRequest: MergeRequestEvent,
): Promise<PullRequest[]> {
  // TODO add sort parameter
  const repo = getGitHubRepoName(mergeRequest);
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "GET",
      headers: getGitHubHeaders(token),
    },
  );

  if (response.status !== 200 && response.status !== 304) {
    console.log("Received unexpected response:", response.status);
    return [];
  }

  return await response.json() as PullRequest[];
}

function getGitHubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function createGithubMergeRequest(
  token: string,
  owner: string,
  mergeRequest: MergeRequestEvent,
) {
  const repo = getGitHubRepoName(mergeRequest);
  try {
    const body = JSON.stringify(
      buildGithubPullRequestPayloadByGitlabMergeRequest(
        mergeRequest.object_attributes,
      ),
    );
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: "POST",
        headers: getGitHubHeaders(token),
        body: body,
      },
    );
    console.debug("PR Create status code:", response.status);
    return response.status === 201;
  } catch (e) {
    console.error("Error by creating all github pull requests:", e);
    return false;
  }
}

async function closeGithubMergeRequest(
  token: string,
  owner: string,
  mergeRequest: MergeRequestEvent,
) {
  const repo = getGitHubRepoName(mergeRequest);

  // TODO get pull by match
  try {
    // TODO change
    const body = JSON.stringify({
      state: "closed",
    });

    // TODO maybe extract this code
    // Start
    const pullRequests = await getGithubPullRequests(
      token,
      owner,
      mergeRequest,
    );

    // TODO use last commit id instead?
    // The commits can be obtained by pullRequests[0]?._links?.commits?.href for each pull request
    const matchingPullRequest = pullRequests.find(
      (pullRequest: PullRequest) => {
        return pullRequest.title === mergeRequest.object_attributes.title;
      },
    );
    // End

    if (typeof matchingPullRequest === "undefined") {
      console.log("No matching pull requests to close found!");
      return false;
    }

    console.log("Close URL:", `https://api.github.com/repos/${owner}/${repo}/pulls/${matchingPullRequest.number.toString()}`);
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${matchingPullRequest.number.toString()}`,
      {
        method: "PATCH",
        headers: getGitHubHeaders(token),
        body: body,
      },
    );
    console.debug("Close PR status code:", response.status);
    return response.status === 200;
  } catch (e) {
    console.error("Error by creating all github pull requests:", e);
    return false;
  }
}

function buildGithubPullRequestPayloadByGitlabMergeRequest(
  mergeRequestAttributes: MergeRequestAttributes,
): PullRequestDraft {
  return {
    title: mergeRequestAttributes.title,
    head: mergeRequestAttributes.source_branch,
    // head_repo: mergeRequestAttributes.url,
    base: mergeRequestAttributes.target_branch,
    body: mergeRequestAttributes.description,
  };
}

async function handleGitlabWebhookRequest(request: Request): Promise<Response> {
  const text = await request.text();
  try {
    const webhookEvent = JSON.parse(text);
    if (webhookEvent?.event_type === "merge_request") {
      await handleGitlabMergeRequestEvent(webhookEvent as MergeRequestEvent);
    } else {
      console.log(`Unsupported webhook event: ${webhookEvent?.event_type}`);
    }
  } catch (err) {
    console.log("Webhook Error:", err);
    return new Response(`error`, { status: 500, statusText: "ERROR" });
  }
  return new Response(`ok`, { status: 200, statusText: "OK" });
}

async function handleGithubWebhookRequest(request: Request): Promise<Response> {
  const text = await request.text();
  try {
    const webhookEvent = JSON.parse(text);
    if (
      webhookEvent?.action === "completed" &&
      typeof webhookEvent?.workflow_job !== "undefined"
    ) {
      // TODO add comment to gitlab original MR with feature environment
      await handleGithubWorkflowCompleteEvent(
        webhookEvent as WorkflowJobCompletedEvent,
      );
    } else {
      console.log(`Unsupported github webhook event: ${webhookEvent?.action}`);
    }
  } catch (err) {
    console.log("Webhook Error:", err);
    return new Response(`error`, { status: 500, statusText: "ERROR" });
  }
  return new Response(`ok`, { status: 200, statusText: "OK" });
}

async function getWorkflowLogsLink(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<string | undefined> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`,
      {
        method: "GET",
        headers: getGitHubHeaders(token),
      },
    );
    console.debug(
      "Logs link response:",
      response.status,
    );
    response.headers.forEach((value, key) => {
      console.log(`Header ${key}:${value}`);
    });
    return "";
  } catch (e) {
    console.error("Error by getting the logs link:", e);
    return undefined;
  }
}

async function handleGithubWorkflowCompleteEvent(
  webhookEvent: WorkflowJobCompletedEvent,
): Promise<boolean> {
  console.log("Process Gitlab Workflow complete request!");
  const githubToken = Deno.env.get("GITHUB_TOKEN");
  const githubOwner = Deno.env.get("GITHUB_OWNER");
  if (!githubToken || !githubOwner) {
    console.error("One of the GitHub Environment variables ist missing.");
    return false;
  }

  // TODO test if owner name is set
  const downloadLogsLink = await getWorkflowLogsLink(
    githubToken,
    githubOwner,
    webhookEvent.repository.name,
    webhookEvent.workflow_job.run_id,
  );
  console.log("downloadLogsLink", downloadLogsLink);

  /**
   * TODOs:
   * -- get the deployment url by the downloaded logs
   * -- write Preview URL + amt-URLs into the JIRA, if not there
   * -- Optional: Write Message in MS Teams
   * -- cleanup logs
   */
  return true;
}

async function handleGitlabMergeRequestEvent(
  mergeRequestEvent: MergeRequestEvent,
): Promise<boolean> {
  const githubToken = Deno.env.get("GITHUB_TOKEN");
  const githubOwner = Deno.env.get("GITHUB_OWNER");

  if (!githubToken || !githubOwner) {
    console.error("One of the GitHub Environment variables ist missing.");
    return false;
  }
  if (
    !mergeRequestEvent.object_attributes?.draft &&
    mergeRequestEvent.object_attributes?.state === "opened"
  ) {
    console.log("Process Gitlab Merge request!");

    const pullRequestExists = await checkIfGithubPullRequestExists(
      githubToken,
      githubOwner,
      mergeRequestEvent,
    );
    if (pullRequestExists === false) {
      const pullRequestCreated = await createGithubMergeRequest(
        githubToken,
        githubOwner,
        mergeRequestEvent,
      );
      console.log("Pull request created: ", pullRequestCreated);
    }

    const ticketNumber = extractJiraTicketFromMRTitle(
      mergeRequestEvent.object_attributes.title,
    );
    if (ticketNumber) {
      console.log("JIRA Ticket number:", ticketNumber);
    } else {
      console.warn(
        `The JIRA ticket number in ${mergeRequestEvent.object_attributes.url} is missing!`,
      );
    }
  } else if (mergeRequestEvent.object_attributes?.draft) {
    console.log("Ignore merge request because it is in draft!");
  } else if (mergeRequestEvent.object_attributes?.state === "closed") {
    // TODO close github MR
    console.log("Merge request is closed. Closing pull request in github...");
    await closeGithubMergeRequest(githubToken, githubOwner, mergeRequestEvent);
    // TODO handle return value
  }
  return true;
}

Deno.serve(async (request: Request) => {
  // Get information about the incoming request
  const url = new URL(request.url);
  if (url.pathname === "/gitlab-webhook") {
    return await handleGitlabWebhookRequest(request);
  }

  if (url.pathname === "/github-webhook") {
    return await handleGithubWebhookRequest(request);
  }

  // TODO determine why the code is executed by the webhook call
  console.log("Call url default text!!!");
  return new Response(`There is nothing to see here, please move on`);
});
