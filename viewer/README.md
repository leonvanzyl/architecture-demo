# house3d: walkable 3D house from a JSON plan

```bash
npm install
npm run dev        # http://localhost:5173  (vite --host, port 5173)
npm run build      # static build in dist/ (relative paths; works on any static host, and from file:// for the built-in plan)
npm run validate   # validate public/plans/*.json against /workspace/architecture/plan-schema.json
npm run shots      # headless Chrome (SwiftShader WebGL) checks + screenshots into screenshots/
```

* Plan format: see [SPEC.md](SPEC.md). Default plan: `public/plans/cozy-3-bed.json` (from the Architect). `public/plans/index.json` lists the plans in the picker.
* Load a different plan with `?plan=URL`, the picker, **Open…**, or by dragging a JSON file onto the page. Add `&view=walk` or `&view=top&level=0` to choose the starting view.
* Controls: WASD and mouse (click to lock the pointer), V switches walk/orbit, T is top-down, 0-9 picks the level cutaway, M toggles the minimap, R goes back to the front door, H shows help. On touch screens, use the joystick on the left and drag to look.
