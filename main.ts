// TODO clean up code
import type { MergeRequestEvent } from "./gitlabHooks"

// TODO make configurable

// TODO test this with deno
function extractJiraTicketFromMRTitle(title: string): string | null {
    const regex = /.*:.*\(([a-zA-Z]+-[0-9]+)\)/g
    return Array.from(title.matchAll(regex), m => m[1])?.[0] ?? null
}

Deno.serve(async (req: Request) => {
    // Get information about the incoming request
    const url = new URL(req.url);
    // TODO check if a webhook for closed MRs exists (if not maybe for commit in develop branch), for the clean up
    if (url.pathname === '/webhook') {
        const text = await req.text()
        try {
            const webhookEvent = JSON.parse(text)
            if (webhookEvent?.event_type === "merge_request") {
                const event = webhookEvent as MergeRequestEvent
                if (!event.object_attributes?.draft) {
                    console.log('Merge request is not in draft!')
                    const ticketNumber = extractJiraTicketFromMRTitle(event.object_attributes.title)
                    console.log('JIRA Ticket number:', ticketNumber)
                    /* TODOs:
                    * - check if a github MR exists (determined on what information?)
                    * -- if not create one
                    * -- determine how to get the deployment url
                    * --- if not possible get the MR ID and build the id itself
                    * -- write Preview URL + amt-URLs into the JIRA (Ticket number extracted from title)
                    * -- Optional: Write Message in MS Teams
                    */
                } else {
                    console.log('Merge request is in draft!')
                }
            } else {
                console.log(`Unsupported webhook event: ${webhookEvent?.event_type}`)
            }
        } catch (err) {
            console.log('Webhook Error:', err)
            return new Response(`error`, {status: 500, statusText: 'ERROR'})
        }
        return new Response(`ok`, {status: 200, statusText: 'OK'})
    }

    // TODO determine why the code does execute after an error
    console.log('Call url default text!!!')
    return new Response(`There is nothing to see here, please move on`)
});