default:
    just --list

install_hooks:
    ln -sf ./.hooks/pre-push .git/hooks/pre-push
