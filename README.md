# Image Annotator

A lightweight CVAT-like image attribute annotation app using FastAPI, React, and Docker Compose.

## Run

```powershell
docker compose up --build
```

Open http://localhost:5173.

By default the app scans images from `./images` on the host, mounted into the backend at `/images`.
To use another image directory:

```powershell
$env:IMAGE_ROOT="C:\path\to\images"
docker compose up --build
```

When creating a project, enter an image directory relative to that mounted root, for example `/images` or `/images/subfolder`.

## Data

Project index metadata is stored in `./data/projects/meta.json`.
Each project's annotations are stored separately under `./data/projects/<project_name>.json`; duplicate names get a numeric suffix such as `<project_name>_2.json`.
If an older `./data/projects.json` exists, the backend migrates it into the per-project format on startup.
The home page can import a project from one of these project JSON files with the Import JSON button.

CSV export includes image path, annotation status, and one column per project attribute.
Attribute values are exported as `0` for False, `1` for True, and `2` for Unknown.
Attributes named with `Group-Name` are displayed under a `Group` box in the annotator, using `Name` as the visible label. If a name contains multiple dashes, the last dash splits the group and label, so `UpperBody-Color-Black` appears as `Black` under `UpperBody-Color`.

The annotation screen displays images at `height: 512px`. The Resize button only toggles the on-screen display between original-width-by-512-height and `256x512`; it does not modify image files.
The Sampler button, or the `s` key, lets you draw a rectangle on the image, averages RGB inside that region, converts it to HSV, and maps it to the supported color labels with simple HSV rules. Sampler mode exits after one selection.

## Development

Source files are mounted into the containers, so edits under `backend/app` and `frontend/src` hot reload automatically while `docker compose up` is running.

Run `docker compose up --build` after dependency or Dockerfile changes. For ordinary code and CSS edits, `docker compose up` is enough.
