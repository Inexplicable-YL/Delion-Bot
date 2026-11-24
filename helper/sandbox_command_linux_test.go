package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLinuxSandboxCommand(t *testing.T) {
	if _, err := os.Stat(linuxSandboxLauncher); err != nil && os.Getenv("DELION_REQUIRE_LINUX_SANDBOX_TEST") == "" {
		t.Skip("Bubblewrap is not installed")
	}
	ctx := t.Context()
	allowed := runLinuxSandboxCommand(ctx, "exec /bin/cat inputs/1", [][]byte{[]byte("staged data\n")})
	if allowed.Error != "" || allowed.ExitCode == nil || *allowed.ExitCode != 0 || allowed.Output != "staged data\n" {
		t.Fatalf("staged read: %+v", allowed)
	}
	outside := filepath.Join(t.TempDir(), "private")
	if err := os.WriteFile(outside, []byte("outside data"), 0600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	for _, test := range []struct{ name, command string }{
		{"outside read", fmt.Sprintf(`exec /bin/cat %q`, outside)},
		{"working directory write", "printf data > changed"},
		{"input write", "printf data > inputs/1"},
		{"network", fmt.Sprintf("printf data >/dev/tcp/127.0.0.1/%d", port)},
		{"child", "/bin/cat inputs/1; exit $?"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := runLinuxSandboxCommand(ctx, test.command, [][]byte{[]byte("staged data\n")})
			if result.Error != "" || result.ExitCode == nil || *result.ExitCode == 0 || strings.Contains(result.Output, "outside data") || strings.Contains(result.Output, "staged data") {
				t.Fatalf("expected policy denial: %+v", result)
			}
		})
	}
	timeout, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	result := runLinuxSandboxCommand(timeout, "while :; do :; done", nil)
	if result.ExitCode != nil || result.Error == "" || result.Output != "" {
		t.Fatalf("cancelled command: %+v", result)
	}
	result = runLinuxSandboxCommand(ctx, "printf '%0131073d' 0", nil)
	if result.ExitCode != nil || result.Error != "命令输出超过限制" || result.Output != "" {
		t.Fatalf("output limit: %+v", result)
	}
}
