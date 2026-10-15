package glpi_test

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi/glpitest"
)

func TestNormalizeURL(t *testing.T) {
	cases := map[string]string{
		"https://glpi.netics.cl":               "https://glpi.netics.cl/apirest.php",
		"https://glpi.netics.cl/":              "https://glpi.netics.cl/apirest.php",
		"https://glpi.netics.cl/apirest.php":   "https://glpi.netics.cl/apirest.php",
		"https://x.cl/glpi/apirest.php/?a=1#f": "https://x.cl/glpi/apirest.php",
		" http://10.0.0.5:8080/glpi ":          "http://10.0.0.5:8080/glpi/apirest.php",
	}
	for in, want := range cases {
		got, err := glpi.NormalizeURL(in)
		if err != nil || got != want {
			t.Errorf("NormalizeURL(%q) = %q, %v; quiero %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "glpi.netics.cl", "ftp://x"} {
		if _, err := glpi.NormalizeURL(bad); err == nil {
			t.Errorf("NormalizeURL(%q) debió fallar", bad)
		}
	}
	if got := glpi.WebURL("https://x.cl/glpi/apirest.php", "NetworkEquipment", 88); got != "https://x.cl/glpi/front/networkequipment.form.php?id=88" {
		t.Errorf("WebURL = %q", got)
	}
}

func open(t *testing.T, s *glpitest.Server) *glpi.Session {
	t.Helper()
	sess, err := glpi.Open(context.Background(), glpi.Config{URL: s.APIURL(), AppToken: "app", UserToken: "user", VerifyTLS: true, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return sess
}

func TestListPaginaYCierraLaSesion(t *testing.T) {
	s := glpitest.New("app", "user")
	defer s.Close()
	rows := make([]map[string]any, 450)
	for i := range rows {
		rows[i] = map[string]any{"id": i + 1, "name": "PC"}
	}
	s.Set("Computer", rows...)
	sess := open(t, s)
	got, err := sess.List(context.Background(), "Computer", nil)
	if err != nil || len(got) != 450 {
		t.Fatalf("List: %d filas, %v", len(got), err)
	}
	n, err := sess.Count(context.Background(), "Computer")
	if err != nil || n != 450 {
		t.Fatalf("Count = %d, %v", n, err)
	}
	empty, err := sess.List(context.Background(), "Printer", nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("lista vacía: %v %v", empty, err)
	}
	sess.Close()
	if s.Killed != 1 {
		t.Errorf("killSession: %d", s.Killed)
	}
	pages := 0
	for _, c := range s.Calls {
		if c == "GET Computer" {
			pages++
		}
	}
	if pages != 4 { // 3 páginas de 200 + el conteo
		t.Errorf("se esperaban 3 páginas de 200 y el conteo, hubo %d", pages)
	}
}

func TestErroresExplicados(t *testing.T) {
	s := glpitest.New("app", "user")
	defer s.Close()
	_, err := glpi.Open(context.Background(), glpi.Config{URL: s.APIURL(), AppToken: "app", UserToken: "malo", Timeout: 5 * time.Second})
	var api *glpi.APIError
	if !errors.As(err, &api) || api.Code != "ERROR_GLPI_LOGIN_USER_TOKEN" {
		t.Fatalf("token malo: %v", err)
	}
	if ex := glpi.Explain(err); !strings.Contains(ex.Error, "User-Token") || ex.Next == "" {
		t.Errorf("explicación: %+v", ex)
	}
	_, err = glpi.Open(context.Background(), glpi.Config{URL: s.APIURL(), AppToken: "otro", UserToken: "user", Timeout: 5 * time.Second})
	if ex := glpi.Explain(err); !strings.Contains(ex.Error, "App-Token") {
		t.Errorf("app token malo: %+v", ex)
	}
	_, err = glpi.Open(context.Background(), glpi.Config{URL: "http://127.0.0.1:1/apirest.php", UserToken: "user", Timeout: 2 * time.Second})
	if ex := glpi.Explain(err); ex.Error == "" || ex.Raw == "" {
		t.Errorf("sin servidor: %+v", ex)
	}
}

func TestFetchArmaCadaEquipo(t *testing.T) {
	s := glpitest.New("app", "user")
	defer s.Close()
	s.Set("Entity",
		map[string]any{"id": 0, "name": "Raíz", "completename": "Raíz"},
		map[string]any{"id": 3, "name": "Casinos", "completename": "Raíz &#62; Netics &#62; Casinos"})
	s.Set("Computer",
		map[string]any{"id": 1042, "name": "SRV-ERP-01", "serial": "CZ2048XK1", "manufacturers_id": "HPE", "computermodels_id": "ProLiant DL380 Gen10",
			"computertypes_id": "Server", "locations_id": "Santiago &#62; Datahouse", "entities_id": "Raíz &#62; Netics &#62; Casinos", "is_template": 0, "is_deleted": 0},
		map[string]any{"id": 7, "name": "Plantilla PC", "is_template": 1, "is_deleted": 0},
		map[string]any{"id": 977, "name": "NB-VENT-02", "is_template": 0, "is_deleted": 1})
	s.Set("NetworkEquipment",
		map[string]any{"id": 88, "name": "SW-ACC-P3", "serial": "FOC2231Y0QZ", "networkequipmenttypes_id": "Switch", "ram": "512", "entities_id": "Raíz", "is_deleted": 0})
	s.Set("OperatingSystem", map[string]any{"id": 4, "name": "Windows Server 2022"})
	s.Set("OperatingSystemVersion", map[string]any{"id": 9, "name": "21H2"})
	s.Set("Item_OperatingSystem", map[string]any{"id": 1, "itemtype": "Computer", "items_id": 1042, "operatingsystems_id": 4, "operatingsystemversions_id": 9})
	s.Set("DeviceProcessor", map[string]any{"id": 2, "designation": "Xeon Gold 6226R"})
	s.Set("Item_DeviceProcessor",
		map[string]any{"id": 1, "itemtype": "Computer", "items_id": 1042, "deviceprocessors_id": 2},
		map[string]any{"id": 2, "itemtype": "Computer", "items_id": 1042, "deviceprocessors_id": 2})
	s.Set("Item_DeviceMemory",
		map[string]any{"id": 1, "itemtype": "Computer", "items_id": 1042, "size": 65536},
		map[string]any{"id": 2, "itemtype": "Computer", "items_id": 1042, "size": "65536"})
	s.Set("Item_DeviceHardDrive",
		map[string]any{"id": 1, "itemtype": "Computer", "items_id": 1042, "capacity": 1966080},
		map[string]any{"id": 2, "itemtype": "Computer", "items_id": 1042, "capacity": 1966080})
	s.Set("IPAddress",
		map[string]any{"id": 1, "mainitemtype": "Computer", "mainitems_id": 1042, "name": "10.10.6.40"},
		map[string]any{"id": 2, "mainitemtype": "Computer", "mainitems_id": 1042, "name": "127.0.0.1"},
		map[string]any{"id": 3, "mainitemtype": "Computer", "mainitems_id": 1042, "name": "fe80::1"},
		map[string]any{"id": 4, "mainitemtype": "NetworkEquipment", "mainitems_id": 88, "name": "10.10.0.3"})
	sess := open(t, s)
	defer sess.Close()
	snap, err := glpi.Fetch(context.Background(), sess, glpi.Options{Computers: true, Network: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Items) != 2 || len(snap.Warnings) != 0 {
		t.Fatalf("equipos: %+v avisos: %v", snap.Items, snap.Warnings)
	}
	srv := snap.Items[0]
	want := glpi.Item{Itemtype: "Computer", ID: 1042, Name: "SRV-ERP-01", Serial: "CZ2048XK1", Manufacturer: "HPE", Model: "ProLiant DL380 Gen10",
		Type: "Server", Location: "Santiago > Datahouse", Entity: "Raíz > Netics > Casinos", EntityID: 3, OS: "Windows Server 2022", OSVersion: "21H2",
		CPU: "2 × Xeon Gold 6226R", RAMMB: 131072, Disk: "2 × 1,9 TB", IPs: []string{"10.10.6.40"}}
	if strings.Join(srv.IPs, ",") != strings.Join(want.IPs, ",") {
		t.Errorf("IP: %v", srv.IPs)
	}
	srv.IPs, want.IPs = nil, nil
	if !reflect.DeepEqual(srv, want) {
		t.Errorf("servidor:\n got %+v\nwant %+v", srv, want)
	}
	sw := snap.Items[1]
	if sw.RAMMB != 512 || sw.Type != "Switch" || len(sw.IPs) != 1 || sw.EntityID != 0 {
		t.Errorf("switch: %+v", sw)
	}
	if _, ok := snap.Trashed["Computer:977"]; !ok || len(snap.Trashed) != 1 {
		t.Errorf("papelera: %v", snap.Trashed)
	}
	if glpi.RAMGB(srv.RAMMB) != "128" || glpi.RAMGB(1536) != "1.5" {
		t.Errorf("RAMGB: %s %s", glpi.RAMGB(srv.RAMMB), glpi.RAMGB(1536))
	}
}

func TestFetchSigueSiFallaUnComponente(t *testing.T) {
	s := glpitest.New("app", "user")
	defer s.Close()
	s.Set("Entity", map[string]any{"id": 0, "completename": "Raíz"})
	s.Set("Computer", map[string]any{"id": 1, "name": "PC-1", "entities_id": "Raíz"})
	s.Fail["Item_DeviceMemory"] = "ERROR_RIGHT_MISSING"
	sess := open(t, s)
	defer sess.Close()
	snap, err := glpi.Fetch(context.Background(), sess, glpi.Options{Computers: true})
	if err != nil || len(snap.Items) != 1 {
		t.Fatalf("Fetch: %v %+v", err, snap.Items)
	}
	if len(snap.Warnings) != 1 || !strings.Contains(snap.Warnings[0], "memoria") {
		t.Errorf("avisos: %v", snap.Warnings)
	}
	s.Fail["Computer"] = "ERROR_RIGHT_MISSING"
	if _, err := glpi.Fetch(context.Background(), sess, glpi.Options{Computers: true}); err == nil {
		t.Error("sin permiso sobre los equipos, la lectura debe fallar entera")
	}
}
