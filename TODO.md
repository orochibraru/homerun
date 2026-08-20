# TODO

- We need to be able to restart/update traefik's docker container from the webapp
- We need to support Postgres as a DB alongside Sqlite
- Make the new volume form a component that's reusable in a modal so we can create a new volume from a service page without getting redirected
- The errors tab shouldn't be just for deployment failures, it should also be for errors logged in the app's logs. A bit like Sentry tracking.
- We need to parse colors and special chars in the container logs
- Setup log retention (for 24hours days by default, extendable to 3months). Logs should be stored as log files and shouldn't be too big so they need to be split. Setup Meilisearch to index logs so we can search them if needed.
