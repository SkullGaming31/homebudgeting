# Contributing

Contributions to Home Budgeting are welcome. For substantial changes, open an issue first to discuss the approach.

## Set up the project

1. Install Node.js and npm.
2. Clone the repository and install the locked dependencies:

   ```powershell
   npm ci
   ```

3. Run the tests and build:

   ```powershell
   npm test
   npm run build
   ```

4. To launch the app locally:

   ```powershell
   npm start
   ```

On Windows, `npm run dist:win` builds the x64 NSIS installer.

## Making a change

- Keep changes focused and follow the existing TypeScript, React, and Electron patterns.
- Add or update tests for behavior changes. The test suite uses Node's built-in test runner and lives in `tests/`.
- For UI changes, include a screenshot or a short description of how you checked the updated screen.
- Run `npm test` and `npm run build` before opening a pull request.
- Do not commit generated build output (`dist/`, `release/`), `node_modules/`, local `.env` files, or credentials.

## Pull requests

Include a concise summary, the reason for the change, and the tests you ran. Mention any known limitations or follow-up work. Keep unrelated formatting or refactoring out of the pull request.

By submitting a contribution, you agree that it may be distributed under the project's MIT License.
