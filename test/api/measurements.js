/*
 * Module dependencies
 */

var request = require('supertest');
var async = require('async');
var should = require('should');
var moment = require('moment');
var mongoose = require('mongoose');

/*
 * The app
 */

var app = require('../../app');

/*
 * Models
 */

var Measurement = mongoose.model('Measurement');
var Sensor = mongoose.model('Sensor');

/*
 * Helpers
 */

var mongodb = require('../../lib/helpers/mongodb');
var factory = require('../../lib/helpers/factory');

/*
 * Config
 */
var config = require('../../config')['test'];
var apiPrefix = config.apiPrefix;

var numberOfSensors = 1;
var daysOfMeasurements = 3;
var defaultPerPage = 20;

/*
 * Test data
 */
var sensor1;
var parameters = config.parameters;

/*
 * The tests
 */
describe('API: Measurements', function(){

  before(function (doneBefore) {
    this.timeout(10000);

    /*
     * Init database
     */
    mongodb.whenReady(function(){
      mongodb.clearDb(function(err){
        if (err) doneBefore(err);

        factory.createSensorsWithMeasurements(numberOfSensors, daysOfMeasurements, function(err, sensor){
          if (err) doneBefore(err);
          sensor1 = sensor[0];
          doneBefore();
        });
      });
    });
  });

  /*
   * GET /api/v1/measurements
  */
  describe('GET /api/v1/measurements', function(){
    it('return 200 and first page when no parameters are passed', function(doneIt){
      var payload = {
        sensor_id: sensor1._id,
        parameter_id: 'atmospheric_pressure'
      }

      /* The request */
    request(app)
      .get(apiPrefix + '/measurements')
      .query(payload)
      .expect('Content-Type', /json/)
      .expect(200)
      .end(onResponse);

    /* Verify response */
    function onResponse(err, res) {
      if (err) return doneIt(err);

      // Check pagination
      var body = res.body;
      body.should.have.property('count', daysOfMeasurements * 24);
      body.should.have.property('perPage', defaultPerPage);
      body.should.have.property('page', 1);

      // Check sensor data
      body.should.have.property('sensor');
      body.sensor.should.have.property('_id', sensor1._id);

      // Check parameter data
      body.should.have.property('parameter');
      body.parameter.should.have.property('_id', payload.parameter_id);

      /* Check data */
      var data = body.measurements;
      data.should.have.lengthOf(defaultPerPage);
      mongoose.model('Measurement')
        .find({
          sensor: payload.sensor_id,
          parameter: payload.parameter_id
        })
        .sort('-collectedAt')
        .limit(defaultPerPage)
        .lean()
        .exec(function(err, measurements){
          if (err) return doneIt(err);

          for (var i = 0; i < defaultPerPage; i++) {

            var measurement = measurements[i];
            data[i].should.have.property('_id', measurement._id.toHexString());
            data[i].should.have.property('value', measurement.value);
            data[i].should.not.have.property('parameter');
            data[i].should.not.have.property('sensor');

            var collectedAt = moment(data[i].collectedAt).format();
            collectedAt.should.equal(moment(measurement.collectedAt).format());
          }
          doneIt();
      });
    }
    });

    it('return 200 and proper page when parameters are passed', function(doneIt){

      var payload = {
        sensor_id: sensor1._id,
        parameter_id: 'atmospheric_pressure',
        page: 3,
        perPage: 14
      }

      /* The request */
      request(app)
        .get(apiPrefix + '/measurements')
        .query(payload)
        .expect('Content-Type', /json/)
        .expect(200)
        .end(onResponse);

      /* Verify response */
      function onResponse(err, res) {
        if (err) return doneIt(err);

        /* Check pagination */
        var body = res.body;
        body.should.have.property('count', daysOfMeasurements * 24);
        body.should.have.property('perPage', payload.perPage);
        body.should.have.property('page', payload.page);
        body.should.have.property('measurements');

        /* Check data */
        var data = body.measurements;
        data.should.have.lengthOf(payload.perPage);
        mongoose.model('Measurement')
          .find({
            sensor: payload.sensor_id,
            parameter: payload.parameter_id
          })
          .sort('-collectedAt')
          .limit(payload.perPage)
          .skip(payload.perPage*(payload.page-1))
          .lean()
          .exec(function(err, measurements){
            if (err) return doneIt(err);
            for (var i = 0; i < payload.perPage; i++) {

              var measurement = measurements[i];
              data[i].should.have.property('_id', measurement._id.toHexString());
              data[i].should.have.property('value', measurement.value);
              data[i].should.not.have.property('parameter');
              data[i].should.not.have.property('sensor');

              var collectedAt = moment(data[i].collectedAt).format();
              collectedAt.should.equal(moment(measurement.collectedAt).format());

            }
             doneIt();
          });
      }
    });
  });


  /*
   * POST /api/v1/measurements/batch
  */
  describe('POST /api/v1/measurements/batch', function(){
    it('should return 200 for valid data', function(doneIt){
      var payload = {
        sensor_id: sensor1._id,
        data: '2015-07-14T10:08:15-03:00;Tw=20.3;Ta:F=78.29;pH=6.9'
      }

      var time = new Date('2015-07-14T10:08:15-03:00');

      request(app)
        .post(apiPrefix + '/measurements/batch')
        .send(payload)
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res){
          if (err) return doneIt(err);
          var body = res.body;

          // Verify each parameter sent
          async.parallel([
            function(doneEach){
              Measurement
                .findOne({
                  sensor: sensor1._id,
                  parameter: 'water_temperature',
                  collectedAt: {
                    $gte: time,
                    $lte: time
                  }
                }, function(err, measurement){
                  if (err) return doneIt(err);
                  should.exist(measurement);
                  measurement.should.have.property('value', 20.3);
                  doneEach();
              });
            },function(doneEach){
              Measurement
                .findOne({
                  sensor: sensor1._id,
                  parameter: 'ambient_temperature',
                  collectedAt: {
                    $gte: time,
                    $lte: time
                  }
                }, function(err, measurement){
                  if (err) return doneIt(err);
                  should.exist(measurement);
                  measurement.should.have.property('value', 78.29);
                  doneEach();
              });
            },function(doneEach){
              Measurement
                .findOne({
                  sensor: sensor1._id,
                  parameter: 'ph',
                  collectedAt: {
                    $gte: time,
                    $lte: time
                  }
                }, function(err, measurement){
                  if (err) return doneIt(err);
                  should.exist(measurement);
                  measurement.should.have.property('value', 6.9);
                  doneEach();
              });
            }], doneIt);
        });
      });
  });

  /*
   * After tests, clear database
   */

  // after(function (done) {
  //   mongodb.clearDb(function(err){
  //     should.not.exist(err);
  //     done(err);
  //   });
  // });
})
