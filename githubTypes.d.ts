// TODO add other fields
export interface PullRequest {
    title: string;
    description: string;
    number: number;
    state: string;
}

export interface PullRequestDraft {
    title: string;
    head: string;
    head_repo?: string;
    base: string;
    body: string;
    maintainer_can_modify?: boolean;
    issue?: number;
}