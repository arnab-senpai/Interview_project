The edge keeps a file as long as the origin's **Cache-Control** header allows. `Cache-Control: public, max-age=31536000` says any cache may keep it for a year.

That is only safe if a file at a given address does not change. So put a fingerprint of the content in the file name: `app.3f9c2a.js`. A new release produces `app.81be07.js`, the page links to the new name, and old copies at the edge stop being asked for. No purge is needed, and the hit rate stays high. The HTML page that links to these files gets a short max-age, because it is the part that changes.
