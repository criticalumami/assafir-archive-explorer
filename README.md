# As-Safir Archive Explorer (السفير)

A blazing-fast, zero-dependency static web application for searching the **As-Safir (السفير)** Lebanese newspaper archive (1974–2016, 2.05M+ articles) and directly downloading **individual Page PDFs** or **full daily Issue ZIPs** without needing a backend server.

## Features

- **Full-Text Search (Arabic & English):** Queries the archive's Elasticsearch backend (`basic-elastic-search-with-counts`) directly from the browser via CORS.
- **Direct 1-Click PDF & Full-Issue ZIP Downloads:**
  - **Page PDF:** `/api/entities/articles/raw/{YYYYMMDDPP}.pdf`
  - **Full Daily Issue ZIP:** `/api/entities/articles/raw-zip/{YYYYMMDD}01.pdf` (bundles all pages of that day's issue into `YYYYMMDD.zip`).
- **Fast PDF Manifest Mode:** Uses the Elasticsearch `sterms#newPdfPath` aggregation endpoint to retrieve up to **10,000 matching PDF filenames in a single HTTP request (~1–2s)** and export bulk download URL lists for `aria2c`, `curl`, or `wget`.
- **Instant Repeat Queries:** Built-in client-side `Map` cache + `AbortController` request cancellation + CSS `content-visibility: auto` for sub-millisecond offscreen list rendering.
