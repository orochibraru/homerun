package provider

import (
	"context"
	"fmt"
	"net/url"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-go/tftypes"

	"github.com/orochibraru/homerun/terraform/provider/internal/client"
)

var _ datasource.DataSourceWithConfigure = (*specDataSource)(nil)

// specDataSource reads one object by id, or by a lookup attribute through
// its collection's search.
type specDataSource struct {
	attributes []Attribute
	client     *client.Client
	spec       DataSourceSpec
}

// NewDataSource returns the constructor the framework calls for spec's
// type, reading the attributes of the resource it mirrors when it has one.
func NewDataSource(spec DataSourceSpec, resources []ResourceSpec) func() datasource.DataSource {
	attributes := spec.Attributes
	for _, resourceSpec := range resources {
		if resourceSpec.Type == spec.Resource {
			attributes = resourceSpec.Attributes
		}
	}
	return func() datasource.DataSource {
		return &specDataSource{attributes: attributes, spec: spec}
	}
}

func (d *specDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + TypeSuffix(d.spec.Type)
}

func (d *specDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = DataSourceSchema(d.spec, d.attributes)
}

func (d *specDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	apiClient, ok := req.ProviderData.(*client.Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data", fmt.Sprintf("%T isn't a Homerun client.", req.ProviderData))
		return
	}
	d.client = apiClient
}

func (d *specDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	config, err := valuesOf(req.Config.Raw)
	if err != nil {
		resp.Diagnostics.AddError("Couldn't read the configuration", err.Error())
		return
	}
	object, err := d.find(ctx, config)
	if err != nil {
		resp.Diagnostics.AddError("Couldn't find the "+d.spec.Type, err.Error())
		return
	}
	typ, ok := req.Config.Schema.Type().TerraformType(ctx).(tftypes.Object)
	if !ok {
		resp.Diagnostics.AddError("Unexpected schema", "The data source's schema isn't an object.")
		return
	}
	values := map[string]tftypes.Value{}
	for tf, attributeType := range typ.AttributeTypes {
		attribute := Attribute{Kind: "string", Name: "id"}
		for _, candidate := range d.attributes {
			if candidate.TF == tf {
				attribute = candidate
			}
		}
		value, err := FromAPI(attribute, attributeType, object[attribute.Name])
		if err != nil {
			resp.Diagnostics.AddError("Couldn't read the "+d.spec.Type, err.Error())
			return
		}
		values[tf] = value
	}
	resp.State.Raw = tftypes.NewValue(typ, values)
}

func (d *specDataSource) find(ctx context.Context, config map[string]tftypes.Value) (client.Object, error) {
	if id, ok := stringValue(config["id"]); ok {
		return d.client.Get(ctx, Path(d.spec.ItemPath, map[string]string{"id": id}))
	}
	for _, name := range d.spec.Lookup {
		var tf string
		for _, attribute := range d.attributes {
			if attribute.Name == name {
				tf = attribute.TF
			}
		}
		wanted, ok := stringValue(config[tf])
		if !ok {
			continue
		}
		return FindOne(ctx, d.client, d.spec.CollectionPath, name, wanted)
	}
	return nil, fmt.Errorf("set id or one of %v", d.spec.Lookup)
}

// FindOne is the one object of a collection whose field equals wanted,
// searched for through the list endpoint's q parameter.
func FindOne(ctx context.Context, apiClient *client.Client, collection, field, wanted string) (client.Object, error) {
	objects, err := apiClient.List(ctx, collection, url.Values{"q": {wanted}})
	if err != nil {
		return nil, err
	}
	var match client.Object
	for _, object := range objects {
		if value, _ := object[field].(string); value == wanted {
			if match != nil {
				return nil, fmt.Errorf("more than one object has %s %q, use its id", field, wanted)
			}
			match = object
		}
	}
	if match == nil {
		return nil, fmt.Errorf("nothing has %s %q", field, wanted)
	}
	return match, nil
}

func stringValue(value tftypes.Value) (string, bool) {
	var text string
	if !value.IsKnown() || value.IsNull() || value.As(&text) != nil || text == "" {
		return "", false
	}
	return text, true
}
