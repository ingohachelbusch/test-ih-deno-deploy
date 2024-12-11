Deno.serve({
    onListen: ({ port }) => {
        console.log("Deno server listening on *:", port);
    },
}, async (req: Request, conn: Deno.ServeHandlerInfo) => {
    // Get information about the incoming request
    const text = await req.text()
    const ip = conn.remoteAddr.hostname;
    console.log(`${ip} just made an HTTP request with the text: ${text}`);

    // Return a web standard Response object
    return new Response("Hello, world!");
});