# snorb26

If the singularity is here, and I've seen it with my ooty-batooty mind's eye, and we're living in a simulation, then God-willing, we've got to do the same and build our own simulation. So play with worlds, plop lemmings, and dream up new things that they could be doing and implement it. Get it done! Send me a PR, or fork into your own path. It's all good. Let's simulate and observe what we come up with!

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

## Testing

There are tests to ensure the security of delta functions

```
# No npm install necessary, no deps!
$ npm test
```

## History

[Proto snorb, dencity in 2010](https://old.latenightsketches.com/ashow/101100.png) used raw 2d canvas and was very slow. Sadly, the source has been lost to time.

[Previous snow orb attempt in 2014](https://github.com/numtel/snorb) fell apart during investigations into a physics engine on top of the terrain, then something changed in the Three.js needing to be updated for modern browsers, and it all became unmaintainable.

[Beginning of raw webgl attempt in 2020](https://config.clonk.me/isometric-test/) ([source](https://github.com/numtel/webgl-isometric/tree/master)) never got very far before shifting to [an orthographic engine for Tiled map editor files](https://github.com/numtel/webgl-isometric)

This new Snorb has been brought to existence with much help from Google Gemini.

## License

GPL v3
