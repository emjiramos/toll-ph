/*
 * Toll PH version history, newest first. The first entry is the version the
 * app shows in its header badge. Add a new entry at the top for every
 * published change; keep each line plain-language, with a bold summary first.
 *
 * Phase: public beta (anyone can use it; not yet confirmed by real drivers on
 * real trips). 1.0 is for when that has happened and nothing was found wrong.
 */
window.TOLLPH_PHASE = "Public beta";
window.CHANGELOG = [
  {
    version: "0.10.0", date: "2026-10-17", title: "Add a stop, and send feedback",
    items: [
      ["Add a stop.", "Tap \"+ Add a stop\" between From and To to plan a trip where you get off and back on, like lunch in Calamba on the way to Batangas. Up to 3 stops. The app prices each part and shows how much the stop adds, since getting back on starts a new toll."],
      ["Send feedback or report a bug.", "A button at the bottom of every tab. Pick Bug, Suggestion or Feedback and type your message. It opens on GitHub ready to send, or by email if you don't have a GitHub account."],
      ["Shared trip links always open the website.", "Links copied from the app now point to the public website, and they keep your stops."]
    ]
  },
  {
    version: "0.9.2", date: "2026-10-17", title: "Google Maps links read correctly",
    items: [
      ["Pasted Google Maps links now start in the right place.", "Some links, such as a trip from a named place to your current location or a dropped pin, showed the wrong toll entry. They now use the start in the link."],
      ["No more silent guesses.", "If the app can't tell where a link's trip starts, it says so instead of keeping the entry you picked before."]
    ]
  },
  {
    version: "0.9.1", date: "2026-10-17", title: "GCash only, for now",
    items: [
      ["Buy me a coffee now offers GCash only.", "PayPal and Wise were taken off because their pages show the owner's full legal name. They may come back with a page that shows a chosen name instead."]
    ]
  },
  {
    version: "0.9.0", date: "2026-10-17", title: "Search any town, and buy me a coffee",
    items: [
      ["Search by town or city.", "Type a town that isn't on an exit sign, like Pagbilao or Lucena, and the app picks the nearest toll entry or exit and says how far it is. Pick towns for both ends and it chooses the best pair. Covers about 370 towns and cities across Metro Manila, Central Luzon and Southern Luzon (from OpenStreetMap)."],
      ["Buy me a coffee.", "A coffee button at the bottom of every tab, and a mug on the sign, open a page for supporting the app. Completely optional."]
    ]
  },
  {
    version: "0.8.0", date: "2026-10-17", title: "Public website and a new look",
    items: [
      ["Toll PH is now a public website.", "Anyone can open it at emjiramos.github.io/toll-ph with no login, and trip links you share open for anyone."],
      ["A new look based on expressway signs.", "Green sign panels, the fare on a yellow toll board, and a typeface modelled on highway lettering."],
      ["Tested on an Android phone, with four fixes.", "Taps on the map no longer land on the wrong plaza (the prompt above the map keeps one height), plaza names no longer pile on top of each other, the map no longer traps page scrolling, and sign corners are round on older phones too."],
      ["Version number and this What's new screen.", "Tap the version badge at the top to see what changed."]
    ]
  },
  {
    version: "0.7.0", date: "2026-10-17", title: "Google Maps and Waze links, clearer fuel cost",
    items: [
      ["Paste a Google Maps or Waze link.", "The app reads where your trip starts and ends and picks the nearest toll entry and exit. Short links (maps.app.goo.gl) can't be opened by the page itself, so it explains how to get the full link."],
      ["Fuel cost as a short list.", "Fuel, tolls and the distance used, instead of one long sentence."],
      ["Type the trip km from Google Maps.", "Fuel then covers the whole trip, including roads to and from the expressway."]
    ]
  },
  {
    version: "0.6.0", date: "2026-10-17", title: "NLEX and a clearer map",
    items: [
      ["NLEX added, Balintawak to Sta. Ines.", "Rates from 20 Jan 2026. Coming off Skyway Stage 3 onto NLEX is two separate tolls, and the route says so."],
      ["One Balintawak.", "NLEX's entrance is \"Balintawak (NLEX)\"; Skyway's own exit is now \"A. Bonifacio (Balintawak)\", its signed name, so the two aren't confused."],
      ["A map you can read.", "Main plazas always named, road names on the lines, area names for orientation, step-by-step prompts, and it zooms to your route."],
      ["Popular trips folded away", "behind a button."]
    ]
  },
  {
    version: "0.5.0", date: "2026-10-17", title: "Search, classes, vehicles and sharing",
    items: [
      ["Find a place by name.", "Type Tagaytay, MOA, airport or Nuvali and pick the right exit."],
      ["Class 1, 2 and 3.", "Switch class right on the trip."],
      ["Totals per RFID sticker.", "What Autosweep roads and Easytrip roads each take."],
      ["Fuel and tolls in one total.", ""],
      ["Share a trip by link.", "The link opens with the same From, To, class and round trip."],
      ["Vehicles.", "Save your car's plate, class, fuel use and RFID account numbers, with copy buttons and links to reload online. Saved only on your phone."],
      ["Popular trips.", "One-tap common routes."]
    ]
  },
  {
    version: "0.4.0", date: "2026-10-17", title: "NAIAX, CAVITEX, CALAX and the map",
    items: [
      ["NAIAX with its airport ramps.", "Terminals 1, 2 and 3, Entertainment City and Macapagal."],
      ["CAVITEX and the C5 Link to Taguig.", "The C5 Link has been fully tolled since 9 May 2026."],
      ["CALAX, including Governor's Drive.", "The new west end has been tolled since 9 Aug 2026; only its published fares are included."],
      ["Network map.", "Every toll road at its real position. Tap where you get on, then where you get off."]
    ]
  },
  {
    version: "0.3.0", date: "2026-10-17", title: "A route guide for new drivers",
    items: [
      ["Step-by-step route.", "Which direction, the exits you'll pass and what each would cost, where your exit leads, distance and time, and where the toll is charged."],
      ["Fares from here.", "Pick an entry to see the fare to every exit."],
      ["Price history.", "For example, \"was ₱126 before 1 Jul 2026\"."],
      ["Trip history and driver tips,", "including RFID rules, speed limits and hotlines, all from published sources."]
    ]
  },
  {
    version: "0.2.0", date: "2026-10-17", title: "Skyway and MCX",
    items: [
      ["Skyway Stages 1–2 and MCX added.", "They share one toll table with SLEX, so a trip across them is a single charge."],
      ["Skyway Stage 3 added as its own road,", "joined at Buendia."]
    ]
  },
  {
    version: "0.1.0", date: "2026-10-17", title: "First version: SLEX",
    items: [
      ["SLEX toll calculator.", "Magallanes to Sto. Tomas at the 1 July 2026 rates, checked against TRB-announced fares and Expressway.PH."]
    ]
  }
];
