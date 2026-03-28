# Snorb File Format

The Snorb file format is a human-readable, CSS-inspired serialization format designed for easy manual editing in any text editor. It consists of two parts: **Text Blocks** for world objects and settings, and a **Binary Data Blob** for high-density grid information.

## 1. File Structure
The file is parsed top-to-bottom. It is case-sensitive and uses curly braces `{}` to define object scopes.

```css
blockType {
  property: value;
  property: value;
}

__DATA__
[Base64 Encoded Binary]
```

---

## 2. Text Blocks

### `map`
Defines the global environment and grid dimensions.
* **width / height**: The dimensions of the tile grid (typically 256).
* **waterLevel**: 0-255. Determines the elevation at which the water plane renders.
* **showGrid**: `true` or `false`.

### `camera`
Stores the viewport state.
* **panX / panY**: World coordinates of the camera focus.
* **zoom**: 1.0 is default.
* **tilt**: Vertical skew (0.35 to 2.0).
* **rotation**: Radiant value for world rotation.

### `cube`
Defines a primitive 3D box.
* **x / y**: World position.
* **w / l / h**: Width, Length, and Height.
* **r**: Rotation in radians.
* **c**: Color as three comma-separated floats (`R, G, B`) from 0.0 to 1.0.

### `path`
Defines an extruded 3D polyline (roads, fences, paths).
* **width / height**: Thickness and verticality of the extrusion.
* **color**: `R, G, B` floats.
* **points**: A pipe-separated (`|`) list of coordinates. 
    * *Example:* `10,10 | 20,10 | 20,20`

---

## 3. The Binary Data Section
The line `__DATA__` acts as a strict separator. Everything following this line is a **Base64 encoded string** representing a raw byte array.

### Data Layout (Unpacked)
Once decoded from Base64, the resulting byte array has a length of $Width \times Height \times 2$.

1.  **First Half ($0$ to $W \times H$):** Elevation Data. Each byte represents the height (0-255) of a specific tile.
2.  **Second Half ($W \times H$ to End):** Building Data. Each byte represents the sprite ID or building type assigned to that tile.

> **Note to Editors:** While you can easily edit the `cube` or `path` blocks in a text editor, editing the `__DATA__` section manually is not recommended. If you want to change the terrain via text, it is often easier to delete the `__DATA__` section entirely; the engine will simply load a flat map while keeping your hand-typed cubes and paths.

---

## 4. Example File
```css
map {
  width: 256;
  height: 256;
  waterLevel: 86;
}

cube {
  x: 128;
  y: 128;
  w: 10;
  l: 10;
  h: 50;
  r: 0.785;
  c: 1.0, 0.0, 0.0;
}

path {
  width: 2.0;
  height: 0.5;
  color: 0.2, 0.2, 0.2;
  points: 100,100 | 150,100 | 150,150;
}

__DATA__
AAC0v7+/v7+/v78...[truncated]
```

