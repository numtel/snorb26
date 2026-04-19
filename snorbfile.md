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

> **Note to Editors:** Comments can be added using standard `//` line prepends and will be preserved.

### `map`
Defines the global environment and grid dimensions.
* **version**: Currently, 2. The original version 1 was the JSON format.
* **width / height**: The dimensions of the tile grid (typically 256).
* **waterLevel**: 0-255. Determines the elevation at which the water plane renders.
* **showGrid**: `true` or `false`.
* **showUnderground**: `true` or `false`.
* **loveChance**: Base probability (0.0 to 1.0) of falling in love.
* **ageGapPenalty**: Reduction in love chance per year of age difference.
* **babyChance**: Probability of having a baby per tick when ready.
* **babyCooldown**: Time in seconds before having another baby.
* **maxBirthAge**: Maximum age a lemming can reproduce.
* **deathAge**: Age at which death becomes possible.
* **deathChance**: Base multiplier for the chance of death per tick above the death age.

### `camera`
Stores the viewport state.
* **panX / panY**: World coordinates of the camera focus.
* **zoom**: 1.0 is default.
* **tilt**: Vertical skew (0.35 to 2.0).
* **rotation**: Radiant value for world rotation.

### `brush`
Stores the brush settings.
* **radius**: Size (1 to 8)
* **smooth**: Factor (0 to 1)

### `customBuildings`
Stores the URLs for the custom sprites used in the Forest/Custom Build tools
* *index*: URL (ensure CORS for URLs on other domains)

### `cube`
Defines a primitive 3D box.
* **x / y**: World position.
* **w / l / h**: Width, Length, and Height.
* **r**: Rotation in radians.
* **c**: Color as three comma-separated floats (`R, G, B`) from 0.0 to 1.0.
* **dx / dy / dw / dl / dh / dr**: (Optional) Mathematical expressions for delta values evaluated dynamically over time `t` (in seconds). Supports all standard JavaScript `Math` operations using shorthand (e.g., `sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `floor`, `pow`), and the constant `pi`. For security, only pure mathematical expressions containing numbers, standard operators, and supported functions are allowed.
* **dc**: (Optional) Three comma-separated math expressions for color channel deltas.

### `path`
Defines an extruded 3D polyline (roads, fences, paths).
* **width / height**: Thickness and verticality of the extrusion.
* **altitude**: Float value position adjustment above or below terrain
* **color**: `R, G, B` floats.
* **points**: A pipe-separated (`|`) list of coordinates. 
    * *Example:* `10,10 | 20,10 | 20,20`
* **dw / dh / da**: (Optional) Math expressions for delta Width, Height, and Altitude evaluated dynamically over time `t` (in seconds).
* **dc**: (Optional) Three comma-separated math expressions for color channel deltas.
* **dp**: (Optional) Math expressions for delta values of points. Expected as a pipe-separated (`|`) list of `dx,dy` math pairs corresponding exactly to the number of nodes in `points`. Empty pairs are allowed if you only want to move specific nodes.
    * *Example (Wobbling middle node):* `0,0 | 10*sin(t), 10*cos(t) | 0,0`

### `lemming`
Defines a lemming.
* **id**: String, unique identifier for the lemming.
* **partnerId**: (Optional) String, the ID of their lifelong partner.
* **x / y / a / s**: Position, angle, speed
* **c**: Color as three comma-separated floats (`R, G, B`) from 0.0 to 1.0.
* **hasBuilt**: Boolean, can only build one cube
* **hasResource**: Boolean, whether it has demolished a sprite and is ready to build
* **isDigging**: (Optional) Boolean, whether the lemming is currently digging.
* **digTimer**: (Optional) Float, remaining time in seconds the lemming will dig.
* **isDancing**: (Optional) Boolean, whether the lemming is currently dancing.
* **danceTimer**: (Optional) Float, remaining time in seconds the lemming will dance.
* **danceRestTimer**: (Optional) Float, remaining time in seconds the lemming must rest before dancing again.
* **stress**: (Optional) Float, how overwhelmed the lemming currently feels.
* **isThinking**: (Optional) Boolean, whether the lemming has paused to reflect on their choices.
* **thinkTimer**: (Optional) Float, remaining time in seconds the lemming will think before emitting a healing shockwave.
* **grownUp**: (Optional) Boolean, whether the lemming has grown up and become more likely to blaze a trail
* **age**: Float, time that a lemming has lived
* **babyCooldown**: (Optional) Float, remaining time in seconds until lemming can have another baby
* **glistenTimer**: (Optional) Float, time in seconds that a baby will glisten and shine
* **targetNewbornId**: (Optional), String, ID of the newborn to which they'll angle towards
* **danceProclivity**: (Optional) Float between 0.0 and 1.0 representing how likely they are to randomly start dancing.
* **parentIds**: (Optional) Comma-separated list of parent IDs for monitoring lineage.

> [!CAUTION]
> Lemmings **SHOULD** have their own free will.
>
> There's a reason you can't change their action properties in the query dialog.
>
> Changing these properties manually in your snorb file is not recommended!

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


cube {
  x: 180;
  y: 90;
  w: 20.95898779020532;
  l: 33.35747038985457;
  h: 79;
  r: 2.55;
  c: 0.1, 0.2549019607843137, 0.6745098039215687;
  // Oscillate smoothly between 180 and 200 every 30 seconds
  dx: 10 - 10 * cos((2 * pi) / 30 * t);
  // Fluctuate the redness every 3 seconds
  dc: 0.9 * 0.9 * cos((2 * pi) / 3 * t), 0 , 0;
  // Full rotation every 3 seconds
  dr: (2 * pi) / 3 * t;
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

