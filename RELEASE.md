# Release

To create a release, go to GitHub actions and run a custom workflow release:
https://github.com/containers/podman-desktop-extension-minikube/actions/workflows/release.yaml

To cut a 0.2.0 release with a v0.2.0 tag, start a new job clicking `Run workflow ⬇️` button.
Enter '0.2.0' in the form and click on 'Run workflow' green button.

It will do the job and create a Pull Request to upgrade to `0.3.0-next`.
Please approve it and it will automatically merge the pull request when PR checks are done.
