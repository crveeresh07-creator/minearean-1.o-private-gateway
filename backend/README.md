# PRIVACY GATEWAY: DPDP-Ready Enterprise AI Architecture

This directory contains the FastAPI Python backend for MINEARENA 1.0 – PS-02: DPDP-Ready Privacy Gateway for Enterprise LLMs.

## Root Cause of "Empty or unreadable file buffer received" & "Failed to fetch"

1. **Missing Multipart Parser on Gateway (`req.file` undefined)**:
   - When sending `FormData` from the frontend, Express did not have a multipart handler (such as `multer`) mounted on `/extract`.
   - Without `multer`, `req.file` was `undefined` and `req.body` was empty `{}`.
   - The handler received a 0-byte buffer and returned: `"Document extraction service error: Empty or unreadable file buffer received. Please select a valid document."`
   - **Fix Applied**: Mounted `multer({ storage: multer.memoryStorage() })` middleware (`upload.single('file')`) on `/extract` and `/api/extract` in `server.ts` and verified `file: UploadFile = File(...)` in `backend/main.py`.

2. **Incorrect `Content-Type` Header**:
   - Manually setting `headers: { 'Content-Type': 'multipart/form-data' }` in `fetch()` strips the browser's automatically generated multipart boundary string (`boundary=----...`).
   - **Fix Applied**: Never pass a manual `Content-Type` header when sending `FormData`. Let the browser set it automatically.

3. **Mixed Content / HTTPS-to-HTTP Block**:
   - When the web application is hosted on HTTPS (such as Google AI Studio preview at `https://ais-dev-*.run.app`), modern browsers block insecure HTTP requests to `http://localhost:8000` or `http://127.0.0.1:8000`.
   - **Fix Applied**: Use the app's same-origin fullstack proxy (`/api/*`), or expose the local FastAPI server via a secure HTTPS tunnel (Cloudflare Tunnel `cloudflared` or `ngrok`) and set that URL in the app's **Settings** panel.

4. **Field Name Mismatch**:
   - FastAPI and Express expect `file: UploadFile = File(...)`. The frontend `FormData` must use `formData.append("file", file, file.name)`.
   - **Fix Applied**: Standardized field name `'file'` across frontend, Express, and FastAPI.

---

## Quick Start on Windows

1. Run the Python FastAPI Backend:
   ```cmd
   cd backend
   run_backend.bat
   ```
   Or manually:
   ```cmd
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. Run the React Frontend:
   ```cmd
   run_frontend.bat
   ```
   Or manually:
   ```cmd
   npm install
   npm run dev
   ```

---

## Connecting from Google AI Studio Preview

Because Google AI Studio runs in the cloud over HTTPS, to test with your local Python FastAPI backend:

1. In a terminal where your FastAPI is running on port 8000:
   ```bash
   npx ngrok http 8000
   ```
2. Copy the HTTPS forwarding address (e.g. `https://xyz.ngrok-free.app`).
3. Open the **Settings** section in the Privacy Gateway web app.
4. Paste the URL into **FastAPI Backend URL** and click **Test Connection**.
5. When HTTP 200 is verified, the app will route all extraction and processing through your FastAPI server!
