---
title: "Playback analytics"
description: "Track plays, completion, and listening time for audioproxy-served audio with a small client-side beacon, and why the proxy itself cannot do this for you."
---

<!-- authored here; no synced counterpart in the proxy repo -->

audioproxy tells you everything about *rendering* audio and nothing about
*listening* to it. That is by design: on a cache hit the proxy redirects the
player to the storage provider or your CDN and never sees another byte, and
even when it does stream the file itself, byte ranges cannot distinguish an
hour of listening from an hour of scrubbing. Playback truth exists in exactly
one place, the `<audio>` element in your user's browser. This guide shows how
to collect it there with a small beacon and send it to your own app, using
nothing but browser APIs.

If you are coming from a hosted service like Mux, this replaces the
client-side half of its analytics: the part its player SDK did by phoning
home. The difference is that the events land in your own database, joined to
your own records, with no third party in the loop.

## What to record

Four event types cover most product questions about audio:

- **`play`**, the first time playback starts for a given page view. Answers
  "how many items get listened to at all".
- **`progress`**, fired after each fixed amount of *actual listening time*,
  say 15 seconds. Summing these gives total listening time; the count per
  item gives a retention curve. Fire it from the element's `timeupdate`
  event, but count only time that actually elapsed playing, so a seek from
  0:10 to 3:00 does not credit 170 seconds of listening.
- **`ended`**, the element finished on its own. Plays with no `ended` tell
  you where people give up.
- **`seeked`**, optional, if skipping behavior matters to you.

Each event should carry the identifier your app already has for the audio,
such as the record id you built the proxy URL from. You do not need to parse
anything back out of the URL: your app constructed it, so your app knows what
it points at.

## Sending events: the Beacon API

[`navigator.sendBeacon`](https://developer.mozilla.org/en-US/docs/Web/API/Beacon_API)
is a one-line, fire-and-forget POST that the browser queues even if the page
is being closed. That last property is the reason to prefer it over `fetch`
for analytics: the moment you most want an event delivered (the user leaving
mid-track) is the moment an ordinary request is most likely to be killed.

```js
navigator.sendBeacon(
  "/playback_events",
  JSON.stringify({ event: "progress", item_id: itemId, position: 42.5 })
)
```

The first argument is your app's collection endpoint. The second is the
payload; the browser sends it as the POST body. There is no response to
read and no promise to await, which is exactly right for telemetry: the
player must never wait on analytics.

## A Stimulus controller

For a Rails app with [Stimulus](https://stimulus.hotwired.dev), wrap the
audio element in a controller that translates media events into beacons.
This one implements the listening-time bookkeeping described above:

```js
// app/javascript/controllers/playback_beacon_controller.js
import { Controller } from "@hotwired/stimulus"

// Reports play/progress/ended events for the <audio> element inside it.
// <div data-controller="playback-beacon"
//      data-playback-beacon-item-id-value="42"
//      data-playback-beacon-url-value="/playback_events">
//   <audio src="..." controls></audio>
// </div>
export default class extends Controller {
  static values = {
    itemId: String,               // your record id, echoed back in every event
    url: String,                  // your collection endpoint
    interval: { type: Number, default: 15 }, // seconds of listening per progress event
  }

  connect() {
    this.audio = this.element.querySelector("audio")
    this.listened = 0             // seconds actually spent playing
    this.lastTime = null          // playback position at the last timeupdate
    this.started = false

    this.audio.addEventListener("play", this.onPlay)
    this.audio.addEventListener("timeupdate", this.onTimeUpdate)
    this.audio.addEventListener("ended", this.onEnded)
  }

  disconnect() {
    this.audio.removeEventListener("play", this.onPlay)
    this.audio.removeEventListener("timeupdate", this.onTimeUpdate)
    this.audio.removeEventListener("ended", this.onEnded)
  }

  onPlay = () => {
    if (this.started) return      // report the first start only, not every unpause
    this.started = true
    this.send("play")
  }

  onTimeUpdate = () => {
    const now = this.audio.currentTime
    if (this.lastTime !== null && !this.audio.paused) {
      const delta = now - this.lastTime
      // timeupdate fires a few times per second; a delta larger than a
      // couple of seconds means the user seeked, so credit no listening.
      if (delta > 0 && delta < 2) this.listened += delta
    }
    this.lastTime = now

    if (this.listened >= this.intervalValue) {
      this.listened -= this.intervalValue
      this.send("progress", { position: now })
    }
  }

  onEnded = () => this.send("ended")

  send(event, extra = {}) {
    navigator.sendBeacon(
      this.urlValue,
      JSON.stringify({ event, item_id: this.itemIdValue, ...extra })
    )
  }
}
```

The values API keeps the controller reusable: the item id, the endpoint, and
the progress interval all come from data attributes, so one controller serves
every player on the site. The seek guard in `onTimeUpdate` is the piece most
DIY trackers get wrong; without it, scrubbing inflates listening time and
your retention numbers become fiction.

## Receiving events

The endpoint can be as small as a controller that writes a row. Beacon
requests are ordinary POSTs, so the one Rails-specific wrinkle is CSRF:
`sendBeacon` cannot set custom headers, so skip the token check for this
one endpoint and treat the data accordingly, as untrusted client telemetry.

```ruby
# config/routes.rb
post "/playback_events", to: "playback_events#create"

# app/controllers/playback_events_controller.rb
class PlaybackEventsController < ApplicationController
  skip_before_action :verify_authenticity_token

  def create
    payload = JSON.parse(request.body.read)
    PlaybackEvent.create!(
      event: payload.fetch("event"),
      item_id: payload.fetch("item_id"),
      position: payload["position"],
      user_id: current_user&.id,
      user_agent: request.user_agent
    )
    head :no_content
  end
end
```

If you already run [Ahoy](https://github.com/ankane/ahoy), you have this
endpoint: replace the `send` method's beacon with `ahoy.track(event, {...})`
from [ahoy.js](https://github.com/ankane/ahoy.js) and events arrive in
`ahoy_events` with visit and user attribution handled for you. The Stimulus
controller stays identical apart from that one method.

Client telemetry is trivially forgeable, so treat it as directional product
data, not as a billing or royalty ledger. Validate the shape, cap the rate
per session, and expect some noise.

## What belongs where

A complete picture pairs this client-side layer with what your app already
knows server-side: it built every proxy URL, so it can log renders requested
per item from its own request logs, and cached delivery shows up in your
CDN or storage provider's logs. The beacon covers the one thing neither of
those can see, which is what happened after the bytes arrived.
