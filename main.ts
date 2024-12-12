// TODO split code into multiple files
import type { MergeRequestAttributes, MergeRequestEvent } from "./gitlabHooks.d.ts"
import type { PullRequest, PullRequestDraft } from "./githubTypes.d.ts"

function extractJiraTicketFromMRTitle(title: string): string | null {
    const regex = /.*:.*\(([a-zA-Z]+-[0-9]+)\)/g
    return Array.from(title.matchAll(regex), m => m[1])?.[0] ?? null
}

function getEnvMapping(envVariableName: string) : Map<string, string> {
    const keyValueMap = new Map<string, string>();
    const keyValueMappings = Deno.env.get(envVariableName)
    if(keyValueMappings) {
        keyValueMappings.split(';').forEach((keyValue) => {
            const keyValueArray = keyValue.split('=')
            if(keyValueArray.length === 2) {
                keyValueMap.set(keyValueArray[0], keyValueArray[1])
            }
        })
    }
    return keyValueMap
}

function getGitHubRepoName(mergeRequest: MergeRequestEvent) : string {
    const gitLabRepoName = mergeRequest.repository.name
    const repoNameMapping = getEnvMapping('GITLAB_TO_GITHUB_MAPPING');
    if (repoNameMapping.has(gitLabRepoName)) {
        return repoNameMapping.get(gitLabRepoName)!
    }
    return gitLabRepoName
}

// TODO determine why github returns a 404
async function checkIfGithubPullRequestExists(token: string, owner: string, mergeRequest: MergeRequestEvent): Promise<boolean | undefined> {
    // change match by cases, where the mirrored name differs
    const repo = getGitHubRepoName(mergeRequest)
    const title = mergeRequest.object_attributes.title
    console.log('url:', `https://api.github.com/repos/${owner}/${repo}/pulls`)
    try {
        // TODO add sort parameter
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: 'GET',
            headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            },
        })

        console.log('PR List status code:', response.status)
        if (response.status !== 200 && response.status !== 304) {
            console.log('Error response:', await response.json())
            return undefined
        }

        const pullRequests = await response.json()
        // TODO use last commit id instead
        // The commits can be obtained by pullRequests[0]?._links?.commits?.href for each pull request
        const matchingPullRequest = pullRequests.find((pullRequest: PullRequest) => {
            pullRequest.title = title
        })
        return typeof matchingPullRequest !== "undefined"
    } catch (e) {
        console.error('Error by getting all github pull requests:', e)
        return undefined
    }
}

async function createGithubMergeRequest(token: string, owner: string, mergeRequest: MergeRequestEvent) {
    const repo = getGitHubRepoName(mergeRequest)
    try {
        const body = JSON.stringify(buildGithubPullRequestPayloadByGitlabMergeRequest(mergeRequest.object_attributes))
        console.log('body', body)
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: body
        })
        console.log('PR Create status code:', response.status)
        return response.status === 201
    } catch (e) {
        console.error('Error by creating all github pull requests:', e)
        return false
    }
}

function buildGithubPullRequestPayloadByGitlabMergeRequest(mergeRequestAttributes: MergeRequestAttributes) : PullRequestDraft {
  return {
      title: mergeRequestAttributes.title,
      head: mergeRequestAttributes.source_branch,
      // head_repo: mergeRequestAttributes.url,
      base: mergeRequestAttributes.target_branch,
      body: mergeRequestAttributes.description,
  }
}

function addJiraComment() {
  // TODO implement
}

async function handleGitlabWebhookRequest(request: Request): Promise<Response> {
    const text = await request.text()
    try {
        const webhookEvent = JSON.parse(text)
        if (webhookEvent?.event_type === "merge_request") {
            await handleMergeRequest(webhookEvent as MergeRequestEvent)
        } else {
            console.log(`Unsupported webhook event: ${webhookEvent?.event_type}`)
        }
    } catch (err) {
        console.log('Webhook Error:', err)
        return new Response(`error`, {status: 500, statusText: 'ERROR'})
    }
    return new Response(`ok`, {status: 200, statusText: 'OK'})
}

async function handleGithubWebhookRequest(request: Request): Promise<Response> {
    const text = await request.text()
    try {
        const webhookEvent = JSON.parse(text)
        console.log('Webhook Github:', webhookEvent)
    } catch (err) {
        console.log('Webhook Error:', err)
        return new Response(`error`, {status: 500, statusText: 'ERROR'})
    }
    return new Response(`ok`, {status: 200, statusText: 'OK'})
}

async function handleMergeRequest(mergeRequestEvent: MergeRequestEvent): Promise<boolean> {
    if (!mergeRequestEvent.object_attributes?.draft && mergeRequestEvent.object_attributes?.state === 'opened') {
        console.log('Process Merge request!')
        const githubToken = Deno.env.get('GITHUB_TOKEN')
        const githubOwner = Deno.env.get('GITHUB_OWNER')
        if (!githubToken || !githubOwner) {
            console.error('One of the GitHub Environment variables ist missing.')
            return false
        }

        const pullRequestExists = await checkIfGithubPullRequestExists(githubToken, githubOwner, mergeRequestEvent);
        if (pullRequestExists === false) {
            const pullRequestCreated = await createGithubMergeRequest(githubToken, githubOwner, mergeRequestEvent)
            console.log('Pull request created: ', pullRequestCreated)
        }

        const ticketNumber = extractJiraTicketFromMRTitle(mergeRequestEvent.object_attributes.title)
        if (ticketNumber) {
            console.log('JIRA Ticket number:', ticketNumber)
        } else {
            console.warn(`The JIRA ticket number in ${mergeRequestEvent.object_attributes.url} is missing!`)
        }

        /* TODOs:
        * -- determine how to get the deployment url
        * --- if not possible get the MR ID and build the id itself
        * -- write Preview URL + amt-URLs into the JIRA
        * -- Optional: Write Message in MS Teams
        */
    } else if (mergeRequestEvent.object_attributes?.draft) {
        console.log('Ignore merge request because it is in draft!')
    } else if (mergeRequestEvent.object_attributes?.state === 'closed') {
        // TODO close github MR
        console.log('Merge request is closed!!')
    }
    return true
}

Deno.serve(async (request: Request) => {
    // Get information about the incoming request
    const url = new URL(request.url);
    // TODO check if a webhook for closed MRs exists (if not maybe for commit in develop branch), for the clean up
    if (url.pathname === '/gitlab-webhook') {
        return await handleGitlabWebhookRequest(request)
    }

    if (url.pathname === '/github-webhook') {
        return handleGithubWebhookRequest(request)
    }

    // TODO determine why the code does execute after an error
    console.log('Call url default text!!!')
    return new Response(`There is nothing to see here, please move on`)
})