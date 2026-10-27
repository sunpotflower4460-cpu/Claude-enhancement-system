# cli

Require test and behavior checks. Run the command or module for real: spawn the CLI as a subprocess and assert on arguments, stdout, stderr and exit codes (success and error paths); for libraries, execute node:assert/test-runner cases against the public API.

Use `behavior` actions with expected vs actual observations from the real process. Do not satisfy this profile with an `api` check that needs an HTTP server the product does not have; if the product genuinely exposes HTTP, use the `backend` profile instead. Commands must return nonzero on failure.
