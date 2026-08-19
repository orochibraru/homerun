# TODO

- Make the app API-driven so we can build a CLI on top of the API.
- No sql/drizzle queries in page.server.ts, we need DTOs that are OOP classes (in lib/dto/service-dto.ts for example in which we'd have class ServiceDTO extends BaseDTO) in which we have streamlined methods like "get, list, new, add, delete, update".
- When saving settings for a service, prompt user to redeploy.
- When deploying add a div showing container pull logs or steps like "pulling image", "starting container", "waiting for container to be healthy: retries left, attempt #number, result: "
- Add random number to container name to prevent duplicates/failures
- When containers are in the same project, they should share the same network and subnetwork (unless user asks for isolated deployment in which case the project will have its own network independent of the main localrun network). Creating a project/group/folder should create a subnetwork.
- When a service gets deployed let's print its hostname and port so it can be accessed by other services that are in the same network
- Quick actions in /services don't work
- We need to be able to setup a cron (with a cron wizard) for each service (disabled by default) that auto-updates services periodically
- We need to be able to open a terminal from the web ui to access the containers
- We need to be able to configure volumes for each service OR project to have shared volumes
- We need to be able to configure storage sources for local volumes, mount paths in a dedicated page in the sidebar called "storage"
