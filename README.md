# Verity

Verity identifies suspicious source-code similarity in programming assignments. Similarity is an indicator for academic review; it is not proof of plagiarism or misconduct.

## Project structure

- frontend: React, Vite, Axios UI and frontend environment settings.
- backend: Express API, MongoDB/Mongoose models, authentication, uploads, similarity service, and tests.

## Features

- Professor and student registration, bcrypt password hashing, JWT authentication in an HTTP-only cookie.
- Role-protected assignment management, submissions, versioning, and server-side deadlines, with optional professor-provided base-code templates.
- Assignment submission tracking lists every registered student and shows submitted, submitted late, pending, or missed status; all registered students are considered assigned because the app has no course rosters.
- Java and Python source uploads with MIME/extension validation, size limit, generated storage names, duplicate hashing, and private file access.
- Latest submission per student compared with normalized tokens, k-grams, hashed winnowing fingerprints, Jaccard similarity, and directional coverage.
- Persisted analysis history, review threshold, student names in reports, and CSV export.
- Winnowing-based starter-template fingerprint filtering, common token-sequence details, and professor-only audited pair overrides.
- Separate professor and student workspaces, individual profile pages, editable profile details, and private Multer-backed profile photos.

## Architecture

    flowchart TD
      A[frontend: React + Vite] --> B[Axios with credentials]
      B --> C[backend: Express REST API]
      C --> D[JWT and role middleware]
      C --> E[Mongoose / MongoDB]
      C --> F[Local upload storage]
      C --> G[Similarity service]
      G --> E

## Setup

Use Node.js and start MongoDB locally. Copy the backend environment example and set a long random JWT secret:

    Copy-Item backend/.env.example backend/.env

Frontend configuration is in frontend/.env.example. Copy it to frontend/.env to override VITE_API_URL.

Start MongoDB, then run both application servers from the project root:

    npm run dev

This starts the API on http://localhost:5001 and the UI on http://localhost:5174. Press Ctrl+C to stop both.

You can also run either service separately with npm --prefix backend run dev or npm --prefix frontend run dev. Uploads are stored under backend/uploads by default; UPLOAD_DIR can override it.
## Tests

    npm test

Jest and Supertest exercise routes against the local verity_test database, which is dropped after the suite. Ensure MongoDB is running before testing. Tests cover authentication, role enforcement, assignment ownership/edit/close, file privacy, duplicate uploads, versioning, deadlines, and analysis report names. Similarity tests cover normalization, exact matches, small edits, unrelated code, and short files.

## API

- POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
- GET /api/profile, PUT /api/profile, POST /api/profile/avatar, GET /api/profile/avatar
- GET /api/submissions (signed-in student’s own submissions)
- GET /api/assignments, POST /api/assignments, GET /api/assignments/:id, PUT /api/assignments/:id, PATCH /api/assignments/:id/close
- GET /api/assignments/:id/missing-students (owning professor only; lists non-submitters after the deadline)
- GET /api/assignments/:id/students (owning professor only; lists all registered students and their assignment submission status)
- POST /api/assignments/:id/submissions, GET /api/assignments/:id/submissions
- GET /api/submissions/:id, GET /api/submissions/:id/versions
- POST /api/assignments/:id/analyze, GET /api/assignments/:id/analyses, GET /api/assignments/:id/report.csv, POST /api/reports/override

## Similarity method and limitations

Comments and quoted string contents are normalized, source is tokenized, consecutive five-token sequences are hashed, and a winnowing window selects fingerprints. Pair results report Jaccard similarity and directional fingerprint coverage. A configurable threshold labels pairs REVIEW_REQUIRED or NOT_FLAGGED.

The tokenizer is not a full Java or Python compiler. Common short exercises naturally share code patterns. Similarity cannot establish intent or misconduct. Local disk storage and synchronous analysis are intended for small college datasets, not large production deployments.