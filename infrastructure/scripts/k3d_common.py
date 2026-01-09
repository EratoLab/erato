"""Shared utilities for k3d test scenario management."""

from typing import List

# Valid scenario names
VALID_SCENARIOS = ["basic", "tight-budget", "assistants"]


def get_scenario_source_file(scenario: str) -> str:
    """Return the config file path for a given scenario.
    
    Args:
        scenario: Name of the scenario (e.g., 'basic', 'tight-budget')
        
    Returns:
        Path to the scenario config file relative to chart root
    """
    return f"config/erato.scenario-{scenario}.toml"


def validate_scenario(scenario: str) -> bool:
    """Validate that scenario name is valid.
    
    Args:
        scenario: Name of the scenario to validate
        
    Returns:
        True if valid, False otherwise
    """
    return scenario in VALID_SCENARIOS


def get_helm_scenario_args(scenario: str) -> List[str]:
    """Return Helm arguments to set the scenario.
    
    Args:
        scenario: Name of the scenario (must be valid)
        
    Returns:
        List of Helm arguments to pass to upgrade/install
        
    Raises:
        ValueError: If scenario is not valid
    """
    if not validate_scenario(scenario):
        raise ValueError(f"Invalid scenario: {scenario}. Valid scenarios: {VALID_SCENARIOS}")
    
    source_file = get_scenario_source_file(scenario)
    return ["--set", f"testScenarioConfig.sourceFile={source_file}"]

