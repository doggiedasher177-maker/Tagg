FROM heroiclabs/nakama:3.22.0
COPY server/modules /nakama/data/modules
EXPOSE 7350 7351
ENTRYPOINT ["/bin/sh", "-ec"]
CMD ["/nakama/nakama migrate up --database.address \"$NAKAMA_DATABASE_ADDRESS\" && exec /nakama/nakama --name tagg --database.address \"$NAKAMA_DATABASE_ADDRESS\" --runtime.path /nakama/data/modules --socket.server_key \"$NAKAMA_SERVER_KEY\" --socket.port 7350 --console.port 7351 --console.username \"$NAKAMA_CONSOLE_USERNAME\" --console.password \"$NAKAMA_CONSOLE_PASSWORD\" --console.signing_key \"$NAKAMA_CONSOLE_SIGNING_KEY\" --session.encryption_key \"$NAKAMA_SESSION_ENCRYPTION_KEY\" --session.refresh_encryption_key \"$NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY\" --session.token_expiry_sec 7200 --session.refresh_token_expiry_sec 604800 --runtime.http_key \"$NAKAMA_RUNTIME_HTTP_KEY\" --logger.level INFO"]
