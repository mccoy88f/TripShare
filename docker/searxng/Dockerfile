# SearXNG con la configurazione di TripShare dentro l'immagine: niente file montati dall'host
# (su Coolify un file montato che non esiste viene creato come cartella e SearXNG non parte).
FROM searxng/searxng:latest
COPY --chown=977:977 searxng-settings.yml /etc/searxng/settings.yml
