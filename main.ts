Deno.serve(async (req: Request) => {
    // Get information about the incoming request
    const url = new URL(req.url);
    if (url.pathname === '/webhook') {
        const text = await req.text()
        console.log('Webhook Infos:', text)
        return new Response(`ok`);
    }

    console.log('Call url default text')
    return new Response(`There is nothing to see here, please move on`);
});