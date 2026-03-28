# snorb26

[Previous snow orb attempts](https://github.com/numtel/snorb) fell apart during investigations into a physics engine on top of the terrain, then something changed in the Three.js needing to be updated for modern browsers, and it all became unmaintainable.

This new Snorb has been brought to existence with much help from Google Gemini.

State is persisted in local storage in the browser between page refreshes and maps can be saved and loaded to external files in the [snorbfile format](snorbfile.md).

## Usage

No build script, just serve the directory. For example, using Python:

```
$ git clone https://github.com/numtel/snorb26.git
$ cd snorb26
$ python3 -m http.server 8000
# Now open your web browser to http://localhost:8000/
```

## License

GPL v3
