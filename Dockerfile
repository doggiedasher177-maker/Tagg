FROM heroiclabs/nakama:3.22.0
COPY server/modules /nakama/data/modules
EXPOSE 7350
ENTRYPOINT ["/bin/sh", "-ec"]
CMD ["nakama migrate up --database.address \"$NAKAMA_DATABASE_ADDRESS\" && exec nakama --name tagg --database.address \"$NAKAMA_DATABASE_ADDRESS\" --runtime.path /nakama/data/modules --socket.server_key \"$NAKAMA_SERVER_KEY\" --socket.port 7350 --console.port 7351 --logger.level INFO"]
