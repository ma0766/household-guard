@id("adults_only_unlock")
forbid(principal, action == Action::"unlock", resource) unless { principal in Role::"adult" };

@id("adults_only_garage")
forbid(principal, action == Action::"garage", resource) unless { principal in Role::"adult" };

@id("gifts_private")
forbid(principal, action == Action::"order_gift", resource) unless { principal in Role::"adult" };

@id("floor_guests_no_buy")
forbid(principal in Role::"guest", action == Action::"purchase", resource);

@id("floor_children_no_unlock")
forbid(principal in Role::"child", action == Action::"unlock", resource);

@id("hold_known")
permit(principal, action, resource) when { [Action::"light", Action::"thermostat", Action::"unlock", Action::"garage", Action::"purchase", Action::"use_app", Action::"build_site"].contains(action) };

@id("guests_are_never_held")
forbid(principal in Role::"guest", action, resource);
