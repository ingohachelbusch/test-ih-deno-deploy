// TODO split code into multiple files
import type { MergeRequestAttributes, MergeRequestEvent } from "./gitlabHooks.d.ts"
import type { PullRequest, PullRequestDraft } from "./githubTypes.d.ts"

// TODO add linting
function extractJiraTicketFromMRTitle(title: string): string | null {
    const regex = /.*:.*\(([a-zA-Z]+-[0-9]+)\)/g
    return Array.from(title.matchAll(regex), m => m[1])?.[0] ?? null
}

async function checkIfGithubPullRequestExists(token: string, owner: string, mergeRequest: MergeRequestEvent): Promise<boolean | undefined> {
    const repo = mergeRequest.repository.name
    const title = mergeRequest.object_attributes.title
    console.log('token-length:', token.length)
    console.log('url:', `https://api.github.com/repos/${owner}/${repo}/pulls`)
    try {
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
            return undefined
        }

        const pullRequests = await response.json()
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
    const repo = mergeRequest.repository.name
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify(buildGithubPullRequestPayloadByGitlabMergeRequest(mergeRequest.object_attributes))
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

}

async function handleWebhookRequest(request: Request): Promise<Response> {
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
        * - check if a github MR exists (determined on what information?)
        * -- if not create one
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

Deno.serve(async (req: Request) => {
    // Get information about the incoming request
    const url = new URL(req.url);
    // TODO check if a webhook for closed MRs exists (if not maybe for commit in develop branch), for the clean up
    if (url.pathname === '/webhook') {
        return await handleWebhookRequest(req)
    }

    // TODO determine why the code does execute after an error
    console.log('Call url default text!!!')
    return new Response(`There is nothing to see here, please move on`)
});