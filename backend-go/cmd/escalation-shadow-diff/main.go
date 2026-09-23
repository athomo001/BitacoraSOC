// escalation-shadow-diff compara la escalación del legacy con la del motor
// nuevo (Fase 7 tarea 8, prototipo del shadow-diff que la Fase 14 debe pasar
// sin discrepancias no explicadas antes del corte).
//
// Entrada del legacy: export de la colección catalogLogSources de Mongo como
// arreglo JSON (mongoexport --jsonArray), de donde se usa `name` y
// `escalationFlow`. Mapeo: JSON {"<nombre legacy>": {"serviceId": "..."}}
// (o assetId / territorialUnitId) que dice contra qué scope del sistema nuevo
// comparar cada caso — hasta la ETL de la Fase 14 ese mapeo es manual.
//
// Uso:
//
//	SHADOW_DIFF_TOKEN=<jwt> go run ./cmd/escalation-shadow-diff \
//	  -legacy catalogLogSources.json -map mapeo.json -api http://127.0.0.1:8081 -out reporte.md
//
// Solo lee: consulta /api/escalation/resolve, nunca registra intentos ni envía correos.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/shadowdiff"
)

type legacySource struct {
	Name           string                  `json:"name"`
	EscalationFlow []shadowdiff.LegacyStep `json:"escalationFlow"`
}

type mapping map[string]map[string]string // nombre legacy → {"serviceId": id}

type resolveResponse struct {
	Data struct {
		Steps []struct {
			Order int    `json:"order"`
			Mode  string `json:"mode"`
			Team  struct {
				Members []struct {
					Name     string `json:"name"`
					Channels []struct {
						ChannelType string `json:"channelType"`
						Value       string `json:"value"`
					} `json:"channels"`
				} `json:"members"`
			} `json:"team"`
		} `json:"steps"`
	} `json:"data"`
	Detail string `json:"detail"`
}

func main() {
	legacyPath := flag.String("legacy", "", "export JSON (arreglo) de catalogLogSources del legacy")
	mapPath := flag.String("map", "", "JSON {\"<nombre legacy>\": {\"serviceId\"|\"assetId\"|\"territorialUnitId\": \"<uuid>\"}}")
	api := flag.String("api", "http://127.0.0.1:8081", "URL base de Bitácora Ops")
	out := flag.String("out", "", "archivo de salida del reporte Markdown (por defecto stdout)")
	asJSON := flag.Bool("json", false, "emitir el reporte como JSON en vez de Markdown")
	flag.Parse()
	token := os.Getenv("SHADOW_DIFF_TOKEN")
	if *legacyPath == "" || *mapPath == "" || token == "" {
		fmt.Fprintln(os.Stderr, "faltan -legacy, -map o la variable SHADOW_DIFF_TOKEN")
		flag.Usage()
		os.Exit(2)
	}
	report, err := run(*legacyPath, *mapPath, *api, token)
	if err != nil {
		fmt.Fprintln(os.Stderr, "escalation-shadow-diff:", err)
		os.Exit(1)
	}
	var body []byte
	if *asJSON {
		body, _ = json.MarshalIndent(report, "", "  ")
	} else {
		body = []byte(report.Markdown())
	}
	if *out == "" {
		os.Stdout.Write(body)
	} else if err := os.WriteFile(*out, body, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "escalation-shadow-diff:", err)
		os.Exit(1)
	}
	for _, c := range report.Cases {
		if c.Error != "" || len(c.Discrepancies) > 0 {
			os.Exit(3) // útil en CI: distinto de 0 si hay algo que revisar
		}
	}
}

func run(legacyPath, mapPath, api, token string) (shadowdiff.Report, error) {
	var sources []legacySource
	if err := readJSON(legacyPath, &sources); err != nil {
		return shadowdiff.Report{}, fmt.Errorf("leyendo el export legacy: %w", err)
	}
	var m mapping
	if err := readJSON(mapPath, &m); err != nil {
		return shadowdiff.Report{}, fmt.Errorf("leyendo el mapeo: %w", err)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	var report shadowdiff.Report
	sort.SliceStable(sources, func(i, j int) bool { return sources[i].Name < sources[j].Name })
	for _, src := range sources {
		if len(src.EscalationFlow) == 0 {
			continue // sin flujo en el legacy: nada que comparar
		}
		result := shadowdiff.CaseResult{Name: src.Name}
		target, ok := m[src.Name]
		if !ok || len(target) != 1 {
			result.Error = "sin mapeo al sistema nuevo (agrégalo en el archivo -map)"
			report.Cases = append(report.Cases, result)
			continue
		}
		steps, err := resolve(client, api, token, target)
		if err != nil {
			result.Error = err.Error()
		} else {
			result.Discrepancies = shadowdiff.Compare(src.EscalationFlow, steps)
		}
		report.Cases = append(report.Cases, result)
	}
	return report, nil
}

func resolve(client *http.Client, api, token string, target map[string]string) ([]shadowdiff.NewStep, error) {
	q := url.Values{}
	for k, v := range target {
		q.Set(k, v)
	}
	req, _ := http.NewRequest(http.MethodGet, api+"/api/escalation/resolve?"+q.Encode(), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body resolveResponse
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("el sistema nuevo respondió %d: %s", resp.StatusCode, body.Detail)
	}
	steps := make([]shadowdiff.NewStep, 0, len(body.Data.Steps))
	for _, s := range body.Data.Steps {
		st := shadowdiff.NewStep{Order: s.Order, Mode: s.Mode}
		for _, mem := range s.Team.Members {
			nm := shadowdiff.NewMember{Name: mem.Name}
			for _, c := range mem.Channels {
				if c.ChannelType == "call" || c.ChannelType == "whatsapp" || c.ChannelType == "sms" {
					nm.Phones = append(nm.Phones, c.Value)
				}
			}
			st.Members = append(st.Members, nm)
		}
		steps = append(steps, st)
	}
	return steps, nil
}

func readJSON(path string, dst any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dst)
}
