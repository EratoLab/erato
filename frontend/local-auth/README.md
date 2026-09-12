# Local Dex

`just dev` in `frontend` generates `dex-config.generated.yml` before starting
Dex and oauth2-proxy. When running Compose directly, first run:

```sh
python3 generate_dex_config.py
docker compose up --detach
```

Edit `dex-config.yml` for development identities and OAuth client settings;
the generated file is ignored. Generation preserves every development account
and adds `user-0001@example.com` through `user-1000@example.com`, password
`password`, with the same deterministic `user-NNNN` IDs as the stress-test chart.
Existing development accounts still use password `admin`.

Use `http://localhost:4180` for the application: the registered callback is
`http://localhost:4180/oauth2/callback`, and Dex's issuer is
`http://127.0.0.1:5556`. These hostnames are deliberately distinct; changing
only the application hostname can break redirects/cookies.

See [local load tests](../../e2e-tests/load-tests/README.md) for the OAuth and
profile-identity smoke test (run from the repository root's `e2e-tests` folder).
