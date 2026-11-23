Half of all requests are for images, scripts and stylesheets that are the same for every visitor. They do not need an app server at all.

Put a content delivery network (CDN) in front. Its edge servers sit close to users, keep copies of static files and only ask CityBeat's servers when they don't have a file yet. With about 95% of static requests served at the edge, the app tier sees roughly half the traffic it did, and pages load faster because images travel a shorter distance.
