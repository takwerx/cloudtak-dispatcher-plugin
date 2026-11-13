## How to open or create an event

### Open your event

1. On the **Events** list, press the name of your event.

Near the top, the Dispatcher now shows **Event** and your event’s name. Beside it is how field units get the calls: **Broadcast** and the channel, or **DataSync** and the feed (✓ when you are subscribed to it). Under that line are three buttons:

- **Switch** goes back to the **Events** list, to open another event. The event stays open for everyone else.
- **Report** opens the event’s report (see [Export the data](90-reports.md#export-the-data)).
- **Commands** shows or hides the command line (see [How to type commands instead of clicking](80-command-line.md)).

Below them are the **Active** and **Closed** tabs, each with a count. In Multi-Monitor Mode there is an **Unassigned** tab too (see [Find the calls with no unit](86-second-monitor.md#find-the-calls-with-no-unit)).

The Dispatcher may open your last event on its own.

> [!TIP]
> **Event missing?** You only see events for channels that are turned on. Check your **Channels** list in CloudTAK’s menu (☰). If the event’s channel is turned off, turn it back on. Then press the refresh button (↻). Still missing? Ask your admin, or make a new event (see [Create an event](#create-an-event)).

If a yellow line says **Not subscribed**, press **Recheck**. If it stays, ask your admin.

### Create an event

1. Go to the **Events** list. If an event is open, press **Switch**, under its name.
2. Press **+ New Event**, at the top right.
3. Under **Event Name**, type a short name, such as `2026-FAIR`.
4. Check the **Incident Prefix**. It fills in from the name: FAIR gives incident numbers FAIR-001, FAIR-002 and so on.
5. Under **Delivery to field units**, pick how field units get the calls (see the table).
6. Fill in the boxes for that choice (see the table).
7. Press **Create Event**.

The new event opens, ready for incidents.

| Choice | What field units get | Then fill in |
|---|---|---|
| **DataSync feed** | The calls go into a shared feed. Field units join the feed on their device to see them. | Keep **New feed**. Check the **DataSync Feed Name**. Pick the **Channel for the new feed**. |
| **Broadcast to channel** | The calls show up by themselves on every device in one channel. Field units can’t change them. | Pick the **Channel to broadcast to**. |

A channel is a group of users on your TAK server, such as all units working the event. Only members of the channel see the event and its calls.

> [!NOTE]
> **Ask your admin** which choice and which channel to use. Your agency should decide this ahead of time. If your admin made a feed for you, press **Existing feed**, then **+ Select DataSync Feed**, and pick it.

> [!WARNING]
> **You can’t change this later.** The choice and the channel stay with the event. If you picked wrong, make a new event.

> [!TIP]
> - If **Broadcast to channel** is greyed out, your CloudTAK can’t broadcast. Use **DataSync feed**.
> - If it says a feed with that name already exists, change the **DataSync Feed Name**.
