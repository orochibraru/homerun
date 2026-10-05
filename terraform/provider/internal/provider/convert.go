package provider

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"

	"github.com/hashicorp/terraform-plugin-go/tftypes"
)

// ToAPI turns a known, non-null Terraform value of an attribute into the
// JSON value the REST API takes for it.
func ToAPI(attribute Attribute, value tftypes.Value) (any, error) {
	switch attribute.Kind {
	case "bool":
		var out bool
		err := value.As(&out)
		return out, err
	case "int":
		return int64Of(value)
	case "strings":
		return listToAPI(Attribute{Kind: "string"}, value)
	case "stringMap":
		return mapToAPI(Attribute{Kind: "string"}, value)
	case "intMap":
		return mapToAPI(Attribute{Kind: "int"}, value)
	case "objects":
		return objectsToAPI(attribute, value)
	default:
		var out string
		err := value.As(&out)
		return out, err
	}
}

func int64Of(value tftypes.Value) (int64, error) {
	var number big.Float
	if err := value.As(&number); err != nil {
		return 0, err
	}
	out, _ := number.Int64()
	return out, nil
}

func listToAPI(element Attribute, value tftypes.Value) ([]any, error) {
	var items []tftypes.Value
	if err := value.As(&items); err != nil {
		return nil, err
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		converted, err := ToAPI(element, item)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}

func mapToAPI(element Attribute, value tftypes.Value) (map[string]any, error) {
	var entries map[string]tftypes.Value
	if err := value.As(&entries); err != nil {
		return nil, err
	}
	out := make(map[string]any, len(entries))
	for key, entry := range entries {
		converted, err := ToAPI(element, entry)
		if err != nil {
			return nil, err
		}
		out[key] = converted
	}
	return out, nil
}

func objectsToAPI(attribute Attribute, value tftypes.Value) ([]any, error) {
	var items []tftypes.Value
	if err := value.As(&items); err != nil {
		return nil, err
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		var fields map[string]tftypes.Value
		if err := item.As(&fields); err != nil {
			return nil, err
		}
		object := map[string]any{}
		for _, field := range attribute.Fields {
			fieldValue, ok := fields[field.TF]
			if !ok || fieldValue.IsNull() || !fieldValue.IsKnown() {
				continue
			}
			converted, err := ToAPI(field, fieldValue)
			if err != nil {
				return nil, err
			}
			object[field.Name] = converted
		}
		out = append(out, object)
	}
	return out, nil
}

// FromAPI turns the JSON value the REST API returned for an attribute into
// a Terraform value of type typ; a missing or null value is null.
func FromAPI(attribute Attribute, typ tftypes.Type, raw any) (tftypes.Value, error) {
	if raw == nil {
		return tftypes.NewValue(typ, nil), nil
	}
	switch attribute.Kind {
	case "bool":
		value, ok := raw.(bool)
		if !ok {
			return tftypes.Value{}, fmt.Errorf("%s: expected a boolean, got %v", attribute.Name, raw)
		}
		return tftypes.NewValue(typ, value), nil
	case "int":
		number, err := numberOf(raw)
		if err != nil {
			return tftypes.Value{}, fmt.Errorf("%s: %w", attribute.Name, err)
		}
		return tftypes.NewValue(typ, number), nil
	case "strings", "objects":
		return listFromAPI(attribute, typ, raw)
	case "stringMap", "intMap":
		return mapFromAPI(attribute, typ, raw)
	default:
		if text, ok := raw.(string); ok {
			return tftypes.NewValue(typ, text), nil
		}
		return tftypes.NewValue(typ, fmt.Sprint(raw)), nil
	}
}

func numberOf(raw any) (*big.Float, error) {
	switch value := raw.(type) {
	case json.Number:
		parsed, err := strconv.ParseFloat(value.String(), 64)
		return big.NewFloat(parsed), err
	case float64:
		return big.NewFloat(value), nil
	case int:
		return new(big.Float).SetInt64(int64(value)), nil
	case int64:
		return new(big.Float).SetInt64(value), nil
	default:
		return nil, fmt.Errorf("expected a number, got %v", raw)
	}
}

func elementAttribute(attribute Attribute) Attribute {
	switch attribute.Kind {
	case "intMap":
		return Attribute{Kind: "int", Name: attribute.Name}
	case "objects":
		return attribute
	default:
		return Attribute{Kind: "string", Name: attribute.Name}
	}
}

func listFromAPI(attribute Attribute, typ tftypes.Type, raw any) (tftypes.Value, error) {
	items, ok := raw.([]any)
	listType, isList := typ.(tftypes.List)
	if !ok || !isList {
		return tftypes.Value{}, fmt.Errorf("%s: expected a list, got %v", attribute.Name, raw)
	}
	out := make([]tftypes.Value, 0, len(items))
	for _, item := range items {
		var (
			converted tftypes.Value
			err       error
		)
		if attribute.Kind == "objects" {
			converted, err = objectFromAPI(attribute, listType.ElementType, item)
		} else {
			converted, err = FromAPI(elementAttribute(attribute), listType.ElementType, item)
		}
		if err != nil {
			return tftypes.Value{}, err
		}
		out = append(out, converted)
	}
	return tftypes.NewValue(typ, out), nil
}

func objectFromAPI(attribute Attribute, typ tftypes.Type, raw any) (tftypes.Value, error) {
	entry, ok := raw.(map[string]any)
	objectType, isObject := typ.(tftypes.Object)
	if !ok || !isObject {
		return tftypes.Value{}, fmt.Errorf("%s: expected an object, got %v", attribute.Name, raw)
	}
	fields := map[string]tftypes.Value{}
	for _, field := range attribute.Fields {
		converted, err := FromAPI(field, objectType.AttributeTypes[field.TF], entry[field.Name])
		if err != nil {
			return tftypes.Value{}, err
		}
		fields[field.TF] = converted
	}
	return tftypes.NewValue(typ, fields), nil
}

func mapFromAPI(attribute Attribute, typ tftypes.Type, raw any) (tftypes.Value, error) {
	entries, ok := raw.(map[string]any)
	mapType, isMap := typ.(tftypes.Map)
	if !ok || !isMap {
		return tftypes.Value{}, fmt.Errorf("%s: expected an object, got %v", attribute.Name, raw)
	}
	out := make(map[string]tftypes.Value, len(entries))
	for key, entry := range entries {
		converted, err := FromAPI(elementAttribute(attribute), mapType.ElementType, entry)
		if err != nil {
			return tftypes.Value{}, err
		}
		out[key] = converted
	}
	return tftypes.NewValue(typ, out), nil
}
