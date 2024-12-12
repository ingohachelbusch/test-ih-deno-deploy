# This is a test project to work with gitlab & github & jira

## Requirements

- Install Deno 2

## Local test environment

```sh
deno run --env-file -A main.ts
```


## Deployment

The deployment is over deno deploy, which has a connection to the GitHub Repo.
Deno Deploy automatically rebuilds the application after a github push.

The deployed version is reachable under:
https://ingohachelb-test-ih-den-40.deno.dev/