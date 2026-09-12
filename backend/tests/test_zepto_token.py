from backend.src.email.zepto import normalize_zepto_token, zepto_auth_header

REAL = "wSsVR61x.abcDEF+g=="


def test_bare_token_passes_through():
    assert normalize_zepto_token(REAL) == REAL


def test_strips_a_pasted_full_header_value():
    # The common mistake: the whole "Zoho-enczapikey <token>" pasted into the env.
    assert normalize_zepto_token(f"Zoho-enczapikey {REAL}") == REAL
    # extra/odd whitespace tolerated
    assert normalize_zepto_token(f"  Zoho-enczapikey   {REAL}  ") == REAL


def test_auth_header_is_single_prefix_either_way():
    # This is the bug that produced an opaque HTTP 500: a doubled prefix.
    assert zepto_auth_header(REAL) == f"Zoho-enczapikey {REAL}"
    assert zepto_auth_header(f"Zoho-enczapikey {REAL}") == f"Zoho-enczapikey {REAL}"
    assert "Zoho-enczapikey Zoho-enczapikey" not in zepto_auth_header(f"Zoho-enczapikey {REAL}")
