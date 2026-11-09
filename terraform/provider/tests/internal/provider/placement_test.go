package provider_test

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/hashicorp/terraform-plugin-go/tftypes"
	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
	"github.com/hashicorp/terraform-plugin-testing/terraform"

	"github.com/orochibraru/homerun/terraform/provider/internal/provider"
)

func placementConfig(fake *fakeAPI, constraint string) string {
	return providerBlock(fake) + fmt.Sprintf(`
resource "homerun_service" "api" {
  name           = "API"
  slug           = "api"
  image          = "nginx"
  container_port = 80
  swarm_placement = {
    roles       = ["worker"]
    constraints = [%q]
  }
}
`, constraint)
}

func TestSwarmPlacementRoundTrips(t *testing.T) {
	requireTerraform(t)
	fake := newFakeAPI(t)
	resource.UnitTest(t, resource.TestCase{
		ProtoV6ProviderFactories: factories(),
		Steps: []resource.TestStep{
			{
				Config: placementConfig(fake, "env==prod"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("homerun_service.api", "swarm_placement.roles.0", "worker"),
					resource.TestCheckResourceAttr("homerun_service.api", "swarm_placement.preferences.#", "0"),
					func(*terraform.State) error {
						created := fake.calls("POST", "/services")
						want := map[string]any{"constraints": []any{"env==prod"}, "preferences": []any{}, "roles": []any{"worker"}}
						if len(created) != 1 || !reflect.DeepEqual(created[0].body["swarmPlacement"], want) {
							return fmt.Errorf("unexpected create %v", created)
						}
						return nil
					},
				),
			},
			{
				Config: placementConfig(fake, "env==staging"),
				Check: func(*terraform.State) error {
					updates := fake.calls("PATCH", "/services/id-1")
					want := map[string]any{"swarmPlacement": map[string]any{"constraints": []any{"env==staging"}, "preferences": []any{}, "roles": []any{"worker"}}}
					if len(updates) != 1 || !reflect.DeepEqual(updates[0].body, want) {
						return fmt.Errorf("expected one PATCH of swarmPlacement, got %v", updates)
					}
					return nil
				},
			},
			{
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"deploy_on_change"},
				ResourceName:            "homerun_service.api",
			},
			{
				PreConfig: func() {
					fake.set("/services/id-1", "swarmPlacement", map[string]any{"constraints": []any{}, "preferences": []any{}, "roles": []any{"manager", "worker"}})
				},
				Config:             placementConfig(fake, "env==staging"),
				ExpectNonEmptyPlan: true,
				PlanOnly:           true,
			},
		},
	})
}

func TestObjectValuesRoundTripThroughTheAPI(t *testing.T) {
	placement := provider.Attribute{Fields: []provider.Attribute{
		{Kind: "strings", Name: "roles", TF: "roles"},
		{Kind: "strings", Name: "constraints", TF: "constraints"},
	}, Kind: "object", Name: "swarmPlacement"}
	typ := tftypes.Object{AttributeTypes: map[string]tftypes.Type{
		"constraints": tftypes.List{ElementType: tftypes.String},
		"roles":       tftypes.List{ElementType: tftypes.String},
	}}
	raw := map[string]any{"constraints": []any{"env==prod"}, "roles": []any{"worker"}}
	value, err := provider.FromAPI(placement, typ, raw)
	if err != nil {
		t.Fatal(err)
	}
	back, err := provider.ToAPI(placement, value)
	if err != nil || !reflect.DeepEqual(back, raw) {
		t.Errorf("%v came back as %#v (%v)", raw, back, err)
	}
	if null, err := provider.FromAPI(placement, typ, nil); err != nil || !null.IsNull() {
		t.Errorf("null should stay null: %v %v", null, err)
	}
}
