# snorb26

If the singularity is here, and I've seen it with my ooty-batooty mind's eye, and [we're living in a simulation](https://xkcd.com/505/), then [God-willing](https://www.sccs.swarthmore.edu/users/00/pwillen1/lit/biell.htm), we've got to do the same and build our own simulation. So play with worlds, plop lemmings, and dream up new things that they could be doing and implement it. Get it done! Send me a PR, or fork into your own path. It's all good. Let's simulate and observe what we come up with!

Much Love,
Sen

* Discussion forum on [reddit/r/snorb](https://www.reddit.com/r/snorb/)
* Map state is persisted in local storage in the browser between page refreshes and maps can be saved and loaded to external files in the [snorbfile format](snorbfile.md).

## Usage

No build script, just serve the directory. For example, using Python:

```
$ git clone https://github.com/numtel/snorb26.git
$ cd snorb26
$ python3 -m http.server 8000
# Now open your web browser to http://localhost:8000/
```

## Scripting/Plugin API

A global `window.snorb` object is exposed to interact with the engine. This can be used for writing custom plugins, bots, and macros, or just testing features via the browser developer console.

The object provides access to the engine's core modules:
* **`snorb.state`**: Direct access to map buffers (`elevations`, `buildingAt`, `lemmings`), dimensions (`GRID_W`, `GRID_H`), the camera, and `appState`.
* **`snorb.tools`**: Built-in logic functions for modifying the world, such as editing terrain, manipulating objects, and spawning elements (`seedDemo`, `brushApplyDelta`, `placeLemmingAt`, etc.).
* **`snorb.renderer`**: Functions necessary for triggering WebGL redraws or syncing data to GPU buffers (`uploadElevations`, `rebuildCubeBuffers`, etc.).

### Example API Usage

Open your browser console and try the following script:

```javascript
// Get the center coordinates of the map
const cx = Math.floor(snorb.state.GRID_W / 2);
const cy = Math.floor(snorb.state.GRID_H / 2);

// Configure the brush and apply a terrain modification
snorb.state.brush.radius = 5;
snorb.tools.brushApplyDelta(cx, cy, 20);

// Spawn a lemming in the newly created terrain
snorb.tools.placeLemmingAt(cx, cy);
```

## Testing

There are tests to ensure the security of delta functions

```
# No npm install necessary, no deps!
$ npm test
```

## History

[Proto snorb, dencity in 2010](https://old.latenightsketches.com/ashow/101100.png) used raw 2d canvas and was very slow. Sadly, the source has been lost to time.

[Previous snow orb attempt in 2014](https://github.com/numtel/snorb) fell apart during investigations into a physics engine on top of the terrain, then something changed in the Three.js needing to be updated for modern browsers, and it all became unmaintainable.

Snorb is short for snow orb or [snow globe](https://archive.md/7pnnJ). A graffiti tag near my parent's house, "Snorb 2012," along with "Heaven," that I saw in 2014 inspired the name.

[Beginning of raw webgl attempt in 2020](https://config.clonk.me/isometric-test/) ([source](https://github.com/numtel/webgl-isometric/tree/master)) never got very far before shifting to [an orthographic engine for Tiled map editor files](https://github.com/numtel/webgl-isometric)

Memphis interface originally developed for ERC20 token [Wrap on Privacy](https://numtel.github.io/wrap-on-privacy/) project from 2025.

This new Snorb has been brought to existence with much help from Google Gemini.


## License

GPL v3
