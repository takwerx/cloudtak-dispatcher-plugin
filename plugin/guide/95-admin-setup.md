## How to set up the Dispatcher (for admins)

This section is for whoever sets up the Dispatcher for your agency. Dispatchers can skip it.

Everything here is in **Dispatcher Settings**: press **Settings**, at the top right of the Dispatcher. **← Back** closes it. These settings apply to every event and every dispatcher on this CloudTAK. The one exception is **Display Mode**, which each computer sets for itself (see [Pick your display mode](30-your-settings.md#pick-your-display-mode)).

A setting marked **CloudTAK admin only** can be changed only when you are signed in to CloudTAK as a system admin. Everyone else sees it greyed out.

### Settings for every dispatcher

| Setting | What it does | Who can change it |
|---|---|---|
| **Caller Details** | **Show callers on incident markers**. On (the default): field units see every caller’s name, phone number and note. Off: callers stay in the Dispatcher. Markers already on the map change the next time the incident changes. | Anyone |
| **Report Header** | Your agency’s name, agency ID and logo, at the top of every event’s report. Press **Save header**. | Anyone |
| **CJIS Reminder** | The yellow line at the top of every incident. Turn it off, or change its words and press **Save text**. An empty box puts the default words back. | CloudTAK admin only |
| **Employee Numbers** | Turns on the employee number sign-in (see [Sign in with your employee number](30-your-settings.md#sign-in-with-your-employee-number)). Use it when desks share one CloudTAK login. It is not a password: it records who did what. Off by default. | CloudTAK admin only |
| **Broadcast Mode Incident Closed Marker Retention** | How long a closed incident stays on field units’ maps, marked CLOSED, in an event that uses **Broadcast to channel**. 60 minutes unless you change it. | CloudTAK admin only |

### Load your incident types

Your own incident types, each with a short code if you want one, such as **MVA - Traffic Accident**. CloudTAK admin only.

1. Under **Incident Types**, press **Download example CSV** to see the layout: two columns, code then name, one type per row. The code can be left empty.
2. Make your file the same way. A code is letters and digits only, no spaces, 8 at most.
3. Under **Load from a CSV file (replaces this list)**, pick your file.

The list shows each code and name, and a line says how many types were loaded. If any row is wrong, nothing is loaded: a red box names the rows, and the old list stays. Fix the file and load it again.

- To add one type, type its code and name in the boxes under the list, then press **Add**.
- To take one out, press its red trash can. It goes at once, without asking.
- Turn on **Use only these incident types** to remove the built-in types. Dispatchers then pick from your list only, in its order. With it off, your list is added to the built-in types. While your list is empty, dispatchers still see the built-in types.

A change reaches each dispatcher the next time they start a new incident. Incidents already created keep their type.

### Load your address data

Your agency’s own address points, street intersections and place names. The address search looks in them before the public map (OpenStreetMap), and shows them as **Verified** and **Place** (see [Set the location](50-create-incident.md#set-the-location)). CloudTAK admin only.

1. Under **Local Address Data**, press **Add source**.
2. Pick what each row of your data is: **Address points**, **Street intersections** or **Common places**.
3. Type a **Name**, such as `County address points`.
4. Under **Load from**, pick **A file (CSV or GeoJSON)**. For data your county keeps online, pick **A web address, pulled on a schedule**.
5. Pick the file (**Download example CSV** shows the layout), or type the web address and press **Read columns**. If a line then says **Picked for you**, the Dispatcher changed your choice in step 2 to fit your columns: check it.
6. Under **Field mapping**, check that each item has the right column of your data. Items marked * are needed. Check the preview under it.
7. Press **Upload** (for a web address, **Save and pull now**).
8. Turn on **Use local address data first**. It starts off, and the search uses none of your data until you turn it on.

Then check it: type an address, two cross streets or a place name under **Try it**, at the bottom. It shows what a dispatcher would get from your data alone.

- **Default country** goes in the **Country** box of every result from your data.
- To keep public map results near you, press **Use map centre** (or type the centre), set the **Radius**, and press **Save area**. Then turn on **Only show OpenStreetMap results within my coverage area**.
- Each source shows how many records it has and when it was loaded. **Replace file** loads a new copy of a file. A web address is pulled again on its schedule, or when you press **Refresh now**. **Remove** deletes the source and its records, after asking.
- Leave **Match distances and search behaviour** as it is, unless you have a reason to change it.
