# Project registry

Application code stays in independent Git repositories. This directory holds
cross-repository navigation and shared context, not checkouts, credentials,
or machine-specific paths.

No projects have been registered, and no other repositories have been scanned
or cloned.

Create `projects/<project-id>.md` for each project, for example:

```markdown
# Project name

- ID: example-app
- Purpose: What this repository does.
- Remote: <repository URL>
- Suggested profile: cloudflare-worker
- Local path: resolve `project_paths.example-app` in `machine.local.json`.
- Before editing: read the target repository's own agent instructions.
```

Store local paths in `machine.local.json`, which is excluded from Git:

```json
{
  "schema_version": 1,
  "home_repo_path": "<absolute path to this checkout>",
  "project_paths": {
    "example-app": "<absolute path to the project>"
  }
}
```

Maintain a separate mapping for each machine and operating system. Treat native
Windows and WSL as separate environments.

Before cloning a missing project, obtain user authorization and select an explicit
destination.
