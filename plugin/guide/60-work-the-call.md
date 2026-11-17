## How to work the call

You do all of this in the open incident. In the list, press the incident’s card to open it. A new incident opens by itself when you create it. To keep several calls open at once, see [How to work several calls at once](83-several-calls.md).

At the top of an open incident are **← Back** (back to the list), the incident’s number and type, and the window button (see [Open a call in its own window](83-several-calls.md#open-a-call-in-its-own-window)). Below them, from top to bottom: its status (such as **active** and **Dispatched**), the yellow CJIS reminder, the incident’s details, **Callers**, the notes with the **Add note…** box, and **Assigned Units**. **Show on Map** and **Close Incident** are at the very bottom.

> [!WARNING]
> **Make every change in the Dispatcher, in its panel or a call’s window.** Tapping an incident’s marker on the map opens CloudTAK’s own marker tools, not the Dispatcher’s. Look if you like, but don’t change, move, end or delete anything there. Those tools change only the map marker, never the incident: the incident’s record and report never see the change, some changes are undone the next time the incident changes, and deleting or ending the marker there can take the call off field units’ maps while it is still open. This is because TAK wasn’t built as a CAD: the Dispatcher shows each incident as an ordinary TAK marker, so CloudTAK’s tools work on it like on any other marker.

### Change the location

Use this when the call turns out to be somewhere else.

1. Press **Change**, beside the address in the incident’s details.
2. Under **New location**, set the new spot the same way as for a new incident (see [Set the location](50-create-incident.md#set-the-location)).
3. Press **Save Location**. To leave it as it was, press **Cancel**.

The marker moves on the map. Units on the call get a chat message with the new address. A note keeps both the old and the new location. This also works after the incident is closed.

### Add a caller or a report number

- Another caller: press **+ Add caller**, next to **Callers**. Type the name and phone number, then press **Save**.
- A report number: press **Add** next to **Report #**, in the incident’s details. Type the number, then press **Save**.

Both also work after the incident is closed.

### Add a note

1. Type the note in the **Add note…** box, above **Assigned Units**.
2. Press **Add**.

The note is saved with the time. Units still on the call get it as a chat message.

### Send a unit

1. Under **Assigned Units**, type the unit’s callsign in the **Search contacts to assign…** box.
2. Press the unit in the list.

The unit shows as **Assigned**. Its device gets a chat message with the incident and the address.

To send several units at once, press the people button (👥) next to the box. Tick the units, then press **Assign** (for example **Assign 2 selected**).

A unit works one call at a time. A unit still working another call in this event is greyed out in both lists, with the number of that call without the event’s prefix: **E12 · on 002** means E12 is on FAIR-002. You can’t pick it. To send it here, first press **Clear** for it on that call.

A unit that has cleared from this call can be sent back to it: assign it again. It gets a second line under **Assigned Units**, and the first line keeps its times.

> [!NOTE]
> **Two dispatchers, one unit.** If someone else has just sent the same unit to another call, theirs counts and yours doesn’t. You see **E12 is on 002. Clear it there first.** for 10 seconds. If you picked several units, it adds **Nothing was assigned.** None of them went out. Your picks come back with E12 greyed out: press **Assign** again for the rest.

### Update a unit

Each unit under **Assigned Units** has its own buttons. Press the right one when the unit radios in. The time is saved for you. The unit gets no message for these.

| The unit… | Press | What you see |
|---|---|---|
| has arrived | **On Scene** | The unit shows **On Scene**. |
| is done | **Clear** | The unit stays on the incident, greyed out, with its times. |
| was sent by mistake | the red trash can | The line goes at once, without asking. The note **E12 assigned** stays. |

In Single Monitor Mode, each active incident’s card in the list says **Unassigned** (no unit working it), **Dispatched** (units sent, none there yet) or **On Scene**. In Multi-Monitor Mode the cards have no labels: the **Unassigned** and **Active** tabs sort the calls instead (see [Find the calls with no unit](86-second-monitor.md#find-the-calls-with-no-unit)).
