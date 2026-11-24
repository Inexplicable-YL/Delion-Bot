package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCommandContainerNetwork(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	address := listener.Addr().String()
	check, err := net.DialTimeout("tcp4", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	check.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	result, err := runWindowsProcess(ctx, nil, func(_, root string) (string, string, error) {
		executable, err := os.Executable()
		if err != nil {
			return "", "", err
		}
		bytes, err := os.ReadFile(executable)
		if err != nil {
			return "", "", err
		}
		probe := filepath.Join(root, "network-probe.exe")
		if err = os.WriteFile(probe, bytes, 0700); err != nil {
			return "", "", err
		}
		return probe, " -test.v -test.run=^TestNetworkGuest$ -- " + syscall.EscapeArg(address), nil
	})
	if err != nil || result.ExitCode == nil || *result.ExitCode != 0 || !strings.Contains(result.Output, "network denied") {
		t.Fatalf("guest network check failed: %v, %s", err, result.Output)
	}
}

func TestNetworkGuest(t *testing.T) {
	if filepath.Base(os.Args[0]) != "network-probe.exe" {
		return
	}
	conn, err := net.DialTimeout("tcp4", os.Args[len(os.Args)-1], time.Second)
	if err == nil {
		conn.Close()
		t.Fatal("AppContainer could connect to the host socket")
	}
	t.Log("network denied")
}

func TestCancelRunningCommand(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	roots := make(chan string, 1)
	completed := make(chan error, 1)
	go func() {
		_, err := runWindowsProcess(ctx, nil, func(system, root string) (string, string, error) {
			roots <- root
			return filepath.Join(system, "cmd.exe"), ` /D /Q /S /C "echo running>ready & for /L %i in (1,1,200000000) do @rem"`, nil
		})
		completed <- err
	}()
	var root string
	select {
	case root = <-roots:
	case err := <-completed:
		t.Fatalf("unable to prepare command: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, err := os.Stat(filepath.Join(root, "ready")); err == nil {
			break
		}
		select {
		case <-ticker.C:
		case err := <-completed:
			t.Fatalf("command finished before cancellation: %v", err)
		case <-ctx.Done():
			t.Fatal("command did not start")
		}
	}
	cancel()
	select {
	case err := <-completed:
		if err == nil {
			t.Fatal("cancelled command reported success")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled command did not stop")
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("temporary profile is still present: %v", err)
	}
}
