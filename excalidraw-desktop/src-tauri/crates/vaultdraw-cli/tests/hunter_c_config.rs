//! Hunter C (2026-10-30, C-9): `vaultdraw config set` writes any key and any value. Run with `--ignored`.
//! A wrong type for a known key (`files.auto_reload banana`) and a misspelt key (`files.auto_reloadd`) both answer
//! `changed 1` with exit 0; the bad line then sits in overrides.toml and `config check` reports an error the
//! command never mentioned. The schema and the did-you-mean already exist (`config check`).
//! Reference: Neovim `:set wrap=banana` is refused with E474/E518, naming the option.
use std::process::{Command, Stdio};

fn run(args: &[&str]) -> (i32, String, String) {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().canonicalize().unwrap();
    let (state, runtime, config) = (base.join("state"), base.join("run"), base.join("config"));
    for d in [&state, &runtime, &config] {
        std::fs::create_dir_all(d).unwrap();
    }
    let o = Command::new(env!("CARGO_BIN_EXE_vaultdraw-cli"))
        .env_clear()
        .env("HOME", "/nonexistent-vd-home")
        .env("VAULTDRAW_STATE_DIR", &state)
        .env("VAULTDRAW_RUNTIME_DIR", &runtime)
        .env("VAULTDRAW_CONFIG_DIR", &config)
        .stdin(Stdio::null())
        .args(args)
        .output()
        .unwrap();
    let overrides = std::fs::read_to_string(state.join("overrides.toml")).unwrap_or_default();
    (o.status.code().unwrap_or(-1), String::from_utf8_lossy(&o.stderr).into(), overrides)
}

#[test]
#[ignore = "hunter C claim C-9: fails until config set validates against the schema"]
fn config_set_refuses_a_wrong_type_for_a_known_key() {
    let (code, err, written) = run(&["config", "set", "files.auto_reload", "banana"]);
    assert!(code != 0 && !written.contains("banana"), "exit {code}, stderr {err:?}, overrides.toml now has: {written}");
}

#[test]
#[ignore = "hunter C claim C-9: fails until config set validates against the schema"]
fn config_set_refuses_an_unknown_key() {
    let (code, err, written) = run(&["config", "set", "files.auto_reloadd", "false"]);
    assert!(code != 0 && !written.contains("auto_reloadd"), "exit {code}, stderr {err:?}, overrides.toml now has: {written}");
}
