package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	dsschema "github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/listplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/mapplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// DeployOnChange is the provider-side attribute of a deployable resource.
const DeployOnChange = "deploy_on_change"

type attributeMode struct {
	computed  bool
	optional  bool
	replace   bool
	required  bool
	sensitive bool
	keepState bool
}

func modeOf(attribute Attribute) attributeMode {
	switch {
	case attribute.ReadOnly:
		return attributeMode{computed: true, keepState: true, sensitive: attribute.Sensitive}
	case attribute.Required:
		return attributeMode{replace: attribute.ForceNew, required: true, sensitive: attribute.Sensitive}
	case attribute.WriteOnly || attribute.CreateOnly:
		return attributeMode{optional: true, replace: attribute.ForceNew, sensitive: attribute.Sensitive}
	default:
		return attributeMode{computed: true, keepState: true, optional: true, replace: attribute.ForceNew, sensitive: attribute.Sensitive}
	}
}

func replaceUnlessAdopted(ctx context.Context, req planmodifier.StringRequest, resp *stringplanmodifier.RequiresReplaceIfFuncResponse) {
	resp.RequiresReplace = !req.StateValue.IsNull()
}

// ResourceSchema is the Terraform schema of a resource spec: every
// attribute the API takes or returns, its id, and deploy_on_change when it
// can be deployed.
func ResourceSchema(spec ResourceSpec) schema.Schema {
	attributes := map[string]schema.Attribute{
		"id": schema.StringAttribute{
			Computed:      true,
			Description:   "The object's id.",
			PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
		},
	}
	for _, attribute := range spec.Attributes {
		attributes[attribute.TF] = resourceAttribute(attribute)
	}
	if spec.Deployable {
		attributes[DeployOnChange] = schema.BoolAttribute{
			Computed:    true,
			Default:     booldefault.StaticBool(false),
			Description: "Deploy after every create or change, and wait for the deploy to finish.",
			Optional:    true,
		}
	}
	return schema.Schema{Attributes: attributes, Description: spec.Description}
}

func resourceAttribute(attribute Attribute) schema.Attribute {
	mode := modeOf(attribute)
	switch attribute.Kind {
	case "bool":
		return schema.BoolAttribute{
			Computed: mode.computed, Description: attribute.Description, Optional: mode.optional,
			PlanModifiers: boolModifiers(mode), Required: mode.required, Sensitive: mode.sensitive,
		}
	case "int":
		return schema.Int64Attribute{
			Computed: mode.computed, Description: attribute.Description, Optional: mode.optional,
			PlanModifiers: int64Modifiers(mode), Required: mode.required, Sensitive: mode.sensitive,
		}
	case "strings":
		return schema.ListAttribute{
			Computed: mode.computed, Description: attribute.Description, ElementType: types.StringType,
			Optional: mode.optional, PlanModifiers: listModifiers(mode), Required: mode.required,
			Sensitive: mode.sensitive,
		}
	case "stringMap":
		return mapAttribute(attribute, mode, types.StringType)
	case "intMap":
		return mapAttribute(attribute, mode, types.Int64Type)
	case "objects":
		return schema.ListNestedAttribute{
			Computed: mode.computed, Description: attribute.Description,
			NestedObject: schema.NestedAttributeObject{Attributes: nestedAttributes(attribute.Fields)},
			Optional:     mode.optional, PlanModifiers: listModifiers(mode), Required: mode.required,
		}
	default:
		return stringAttribute(attribute, mode)
	}
}

func mapAttribute(attribute Attribute, mode attributeMode, element attr.Type) schema.MapAttribute {
	return schema.MapAttribute{
		Computed: mode.computed, Description: attribute.Description, ElementType: element,
		Optional: mode.optional, PlanModifiers: mapModifiers(mode), Required: mode.required,
		Sensitive: mode.sensitive,
	}
}

func stringAttribute(attribute Attribute, mode attributeMode) schema.StringAttribute {
	modifiers := []planmodifier.String{}
	if mode.keepState {
		modifiers = append(modifiers, stringplanmodifier.UseStateForUnknown())
	}
	if mode.replace {
		modifiers = append(modifiers, stringplanmodifier.RequiresReplace())
	}
	if attribute.CreateOnly {
		modifiers = append(modifiers, stringplanmodifier.RequiresReplaceIf(
			replaceUnlessAdopted,
			"Changing it replaces the object, unless it was imported without one.",
			"Changing it replaces the object, unless it was imported without one.",
		))
	}
	return schema.StringAttribute{
		Computed: mode.computed, Description: attribute.Description, Optional: mode.optional,
		PlanModifiers: modifiers, Required: mode.required, Sensitive: mode.sensitive,
	}
}

func nestedAttributes(fields []Attribute) map[string]schema.Attribute {
	out := map[string]schema.Attribute{}
	for _, field := range fields {
		required := field.Required
		switch field.Kind {
		case "bool":
			nested := schema.BoolAttribute{Description: field.Description, Optional: !required, Required: required}
			if value, ok := field.Default.(bool); ok {
				nested.Computed, nested.Default = true, booldefault.StaticBool(value)
			}
			out[field.TF] = nested
		case "int":
			out[field.TF] = schema.Int64Attribute{Description: field.Description, Optional: !required, Required: required}
		default:
			nested := schema.StringAttribute{Description: field.Description, Optional: !required, Required: required}
			if value, ok := field.Default.(string); ok {
				nested.Computed, nested.Default = true, stringdefault.StaticString(value)
			}
			out[field.TF] = nested
		}
	}
	return out
}

func boolModifiers(mode attributeMode) []planmodifier.Bool {
	modifiers := []planmodifier.Bool{}
	if mode.keepState {
		modifiers = append(modifiers, boolplanmodifier.UseStateForUnknown())
	}
	if mode.replace {
		modifiers = append(modifiers, boolplanmodifier.RequiresReplace())
	}
	return modifiers
}

func int64Modifiers(mode attributeMode) []planmodifier.Int64 {
	modifiers := []planmodifier.Int64{}
	if mode.keepState {
		modifiers = append(modifiers, int64planmodifier.UseStateForUnknown())
	}
	if mode.replace {
		modifiers = append(modifiers, int64planmodifier.RequiresReplace())
	}
	return modifiers
}

func listModifiers(mode attributeMode) []planmodifier.List {
	modifiers := []planmodifier.List{}
	if mode.keepState {
		modifiers = append(modifiers, listplanmodifier.UseStateForUnknown())
	}
	if mode.replace {
		modifiers = append(modifiers, listplanmodifier.RequiresReplace())
	}
	return modifiers
}

func mapModifiers(mode attributeMode) []planmodifier.Map {
	modifiers := []planmodifier.Map{}
	if mode.keepState {
		modifiers = append(modifiers, mapplanmodifier.UseStateForUnknown())
	}
	if mode.replace {
		modifiers = append(modifiers, mapplanmodifier.RequiresReplace())
	}
	return modifiers
}

// DataSourceSchema is the Terraform schema of a data source: every
// attribute read-only except `id` and the lookup attributes, which pick
// the object.
func DataSourceSchema(spec DataSourceSpec, attributes []Attribute) dsschema.Schema {
	lookups := map[string]bool{}
	for _, name := range spec.Lookup {
		lookups[name] = true
	}
	out := map[string]dsschema.Attribute{
		"id": dsschema.StringAttribute{Computed: true, Description: "The object's id.", Optional: true},
	}
	for _, attribute := range attributes {
		if !attribute.FromAPI() {
			continue
		}
		optional := lookups[attribute.Name]
		out[attribute.TF] = dataSourceAttribute(attribute, optional)
	}
	return dsschema.Schema{Attributes: out, Description: spec.Description}
}

func dataSourceAttribute(attribute Attribute, optional bool) dsschema.Attribute {
	switch attribute.Kind {
	case "bool":
		return dsschema.BoolAttribute{Computed: true, Description: attribute.Description, Sensitive: attribute.Sensitive}
	case "int":
		return dsschema.Int64Attribute{Computed: true, Description: attribute.Description, Sensitive: attribute.Sensitive}
	case "strings":
		return dsschema.ListAttribute{Computed: true, Description: attribute.Description, ElementType: types.StringType, Sensitive: attribute.Sensitive}
	case "stringMap":
		return dsschema.MapAttribute{Computed: true, Description: attribute.Description, ElementType: types.StringType, Sensitive: attribute.Sensitive}
	case "intMap":
		return dsschema.MapAttribute{Computed: true, Description: attribute.Description, ElementType: types.Int64Type, Sensitive: attribute.Sensitive}
	case "objects":
		nested := map[string]dsschema.Attribute{}
		for _, field := range attribute.Fields {
			nested[field.TF] = dataSourceAttribute(field, false)
		}
		return dsschema.ListNestedAttribute{
			Computed: true, Description: attribute.Description,
			NestedObject: dsschema.NestedAttributeObject{Attributes: nested},
		}
	default:
		return dsschema.StringAttribute{
			Computed: true, Description: attribute.Description, Optional: optional, Sensitive: attribute.Sensitive,
		}
	}
}
