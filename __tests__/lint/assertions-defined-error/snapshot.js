// Jest Snapshot v1, https://goo.gl/fbAQLP

exports[`E2E lint assertions-defined-error 1`] = `

validating /openapi.yaml...
[1] openapi.yaml:19:7 at #/paths/~1pet~1findByStatus/get/security

Operation security should be defined

17 | /pet/findByStatus:
18 |   get:
19 |     operationId: example
   |     ^^^^^^^^^^^^^^^^^^^^
20 |     summary: summary example
   |     ^^^^^^^^^^^^^^^^^^^^^^^^
 … |     < 12 more lines >
33 |         description: example description
   |         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
34 |

Error was generated by the rule/operation-security rule.


[2] openapi.yaml:33:11 at #/paths/~1pet~1findByStatus/get/responses/404/content

Response content should be defined

31 |         type: 'string'
32 | '404':
33 |   description: example description
   |   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
34 |

Error was generated by the rule/response-content-defined rule.


/openapi.yaml: validated in <test>ms

❌ Validation failed with 2 errors.
run \`redocly lint --generate-ignore-file\` to add all problems to the ignore file.


`;
