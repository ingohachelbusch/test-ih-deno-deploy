Deno.serve(async (req: Request) => {
    // Get information about the incoming request
    const url = new URL(req.url);
    if (url.pathname === '/webhook') {
        const text = await req.text()
        console.log('Webhook Infos:', text)
        try {
            const webhookEvent = JSON.parse(text)
            if (webhookEvent?.object_kind === "merge_request") {
                console.log('Merge request is created')
                if (webhookEvent?.object_attributes?.draft) {
                    console.log('Merge request is in draft!')
                } else {
                    console.log('Merge request is not in draft!')
                }
            } else {
                console.log(`Unsupported webhook event: ${webhookEvent.object_kind}`)
            }

        } catch (err) {
            console.log('Webhook Error:', err)
            return new Response(`error`, {status: 500, statusText: 'ERROR'});
        }

        return new Response(`ok`, {status: 200, statusText: 'OK'});
    }

    console.log('Call url default text')
    return new Response(`There is nothing to see here, please move on`);
});