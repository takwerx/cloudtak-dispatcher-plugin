## How to type commands instead of clicking

If you would rather type than click, use the command line. Every command does the same thing as its button, so you never have to use it.

### Open the command line

1. Open your event.
2. Press the **F2** key, or press **Commands**, under the event’s name.

A one-line box opens under those buttons, with the cursor in it. At its left is the number of the incident your commands are for, or **No incident**.

- **F2** puts the cursor back in the box at any time.
- **Esc** backs out one step at a time: out of a numbered list, then it closes the list of commands, clears the line, and leaves the box.
- To hide the box, press **Commands** again.
- This computer remembers whether the box is showing. Other desks are not changed.
- In Multi-Monitor Mode, the box is in the workspace, with the Dispatcher. **F2** works there: click in the workspace first.

> [!TIP]
> **F2 changes the volume or the brightness?** On a laptop, turn on Fn Lock first (often **Fn** + **Esc**), or hold **Fn** and press **F2**.

### Type a command

A command has up to three parts, with spaces between them. Then press **Enter**.

| Part | Example | What it means |
|---|---|---|
| The incident number | `14` | Which incident. You can leave it out. |
| The command | `T` | What to do. Capital or small letters both work. |
| Units or text | `caller called back` | Who or what it is about. |

So `14 T caller called back` adds the note “caller called back” to incident 014.

- **No number?** The command is for the incident shown at the left of the box: the one you last opened or clicked in.
- **A unit’s status needs no number.** A unit works one call at a time, so `O H35` finds its call.
- **Type a unit the way it is said on the radio.** One part of its callsign is enough: for a unit named `FIRE-ENGINE-E12`, type `E12`.
- **More than one fit, or only part of a name typed?** A numbered list shows under the box. Type the number of the right one, then press **Enter**.
- **Types and dispositions:** type the start of a word, such as `N fire` or `X unf` (Unfounded). A type’s code works too, such as `N MVA`.
- **Read the line under the box.** Before you press **Enter**, it says how your command was read: grey is fine, yellow means it will not work as typed. After, green says what was done, and red means it was not done.
- **The up arrow key** brings back the lines you typed before.
- **`?`** lists every command. Type `?` again, or press **Esc**, to close the list.

If one unit on a line is wrong, nothing on that line is done. Fix it and press **Enter** again. If a red line starts with **Done:**, it names what was done and the unit that was not: type a new line for that unit only.

### The commands

In this table, `14` stands for an incident number and `H35` or `E6` for a unit.

| Type | What it does |
|---|---|
| `14` | Opens incident 014. |
| `N fire, 120 main` | Opens the new incident form with the type picked and the address searched. Press **Enter** to take the marked address, check the form, then press **Enter** again to create the incident. |
| `A H35 E6` | Sends (assigns) the units. |
| `O H35` | The unit is on scene. |
| `C H35` | The unit is clear. |
| `UN H35` | Removes a unit that was sent by mistake. |
| `T 2 patients, one trapped` | Adds a note. |
| `X unf` | Closes the incident with that disposition. `X other` and a few words is for **Other**. `X` alone lists the dispositions. |
| `14 R caller called back` | Reopens the incident. The words after `R` are the reason. |
| `RN 26-00123` | Sets the report number. |
| `CA J Smith, 555-0100, sees smoke` | Adds a caller: name, phone number, note. |
| `CP 2` | Makes the second caller the primary one. |
| `14 M` | Shows the incident on the map. |
| `14 W` | Opens the incident in its own window. |
| `WX` | Closes the incident’s window. `WX ALL` closes every window. |
| `L` | Goes back to the list. `L A` and `L C` go to the **Active** and **Closed** tabs. In Multi-Monitor Mode, `L U` goes to **Unassigned**. |
| `SI 4521` | Signs in with your employee number. |
| `SO` | Signs out. |
| `EV` | Switches events (the **Switch** button). |
| `REP` | Opens the event’s report. |
| `SET` | Opens Dispatcher Settings. |
| `POP` | Pops the Dispatcher out, or opens the workspace. |
| `DOCK` | Docks the Dispatcher back to the panel. |
| `?` | Lists the commands. |

Some things still need the mouse: creating, archiving and deleting events, dropping a pin on the map, changing a caller, changing an incident’s location, the settings, and the report’s buttons.

While a new incident is open and not yet created, the commands that would leave it are not done: an incident number alone, `N`, `L`, `EV`, `REP` and `SET`. The line under the box says **A new incident is open. Create or cancel it first.** The other commands still work, such as `O H35` or `14 T caller called back`.
