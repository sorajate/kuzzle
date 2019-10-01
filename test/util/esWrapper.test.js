'use strict';

const
  should = require('should'),
  {
    errors: {
      ExternalServiceError
    }
  } = require('kuzzle-common-objects'),
  ESClientMock = require('../mocks/services/elasticsearchClient.mock'),
  ESWrapper = require('../../lib/util/esWrapper');

describe('Test: ElasticSearch Wrapper', () => {
  const
    client = new ESClientMock(),
    esWrapper = new ESWrapper(client);

  describe('#formatESError', () => {
    it('should convert any unknown error to a ExternalServiceError instance', () => {
      const error = new Error('test');
      error.meta = {
        statusCode: 420
      };

      const formatted = esWrapper.formatESError(error);

      should(formatted).be.instanceOf(ExternalServiceError);
      should(formatted.id).be.eql('external.elasticsearch.unexpected_error');
    });

    it('should handle version conflict errors', () => {
      const error = new Error('[version_conflict_engine_exception] [data][AVrbg0eg90VMe4Z_dG8j]: version conflict, current version [153] is different than the one provided [152], with { index_uuid="iDrU6CfZSO6CghM1t6dl0A" & shard="2" & index="userglobaldata" }');
      error.meta = {
        statusCode: 409
      };

      const formatted = esWrapper.formatESError(error);

      should(formatted).be.instanceOf(ExternalServiceError);
      should(formatted.id).be.eql('external.elasticsearch.too_many_changes');
    });

    it('should handle already existing document', () => {
      const error = new Error('');
      error.meta = { body: { error: { reason: '[liia]: version conflict, document already exists (current version [1])' } } };

      const formatted = esWrapper.formatESError(error);

      should(formatted).be.match({
        id: 'external.elasticsearch.document_already_exists'
      });
    });

    it('should handle document not found', () => {
      const error = new Error('test');
      error.meta = { statusCode: 404 };
      error.body = {
        found: false,
        _id: 'mehry',
        error: {
          reason: 'foo',
          'resource.id': 'bar'
        }
      };

      const formatted = esWrapper.formatESError(error);

      should(formatted).be.match({
        id: 'external.elasticsearch.document_not_found'
      });
    });
  });
});
