# TODO

## Thoughts on installer

Move to the init method of sveltekit so it creates everything Ask user to
install docker on their server themselves then run the containers? Would mean
the init methods starts the db containers and traefik itself. Would be nice for
updating. Maybe a bit of both? Small installer that just installs docker,
creates dirs, permissions and starts the main container which does the rest?
