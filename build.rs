fn main() {
    // An 8 MiB stack instead of the target's 1 MiB. On wasm32-wasip3 a task
    // that starts while another holds the main stack (the response body is
    // written from a `spawn_local` task) gets a stack of the same size from
    // `malloc`, right above the static data; overflowing it does not trap but
    // overwrites the statics below. After the target's own `-z stack-size`,
    // and the linker takes the last one.
    if std::env::var("TARGET").is_ok_and(|t| t.starts_with("wasm32")) {
        println!("cargo:rustc-link-arg=-z");
        println!("cargo:rustc-link-arg=stack-size=8388608");
    }
}
